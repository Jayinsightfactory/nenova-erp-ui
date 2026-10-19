// Independent arithmetic: deliberately does not import profitReportCalc or its resolvers.
export const AUDIT_VERSION = 'independent-stock-v1';
export const STOCK_SP_SHA256 = '990d54a853ef8a9794cc76ffcb13a7e720ae2cff13e723ca5c97e235cca1890c';
export const finite = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export const roundQty = v => Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100;
const keyOf = (y, w) => `${y}/${w}`;
const period = row => keyOf(row.OrderYear, row.OrderWeek);
const validWeek = w => /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/.test(String(w));
const grouped = (rows, fn) => {
  const map = new Map();
  for (const row of rows) { const k = fn(row); if (!map.has(k)) map.set(k, []); map.get(k).push(row); }
  return map;
};
const sum = (rows, fn) => rows.reduce((total, r) => total + fn(r), 0);
const format = v => finite(v) === null ? '미확인' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const fieldNames = { N: '순수매출', L: '불량차감', O: '그외매출', Q: '외화 매입액', E: '기초재고액', F: '기말재고액', H: '통관비', R: '과세환율', S: '항공료' };
const priceNames = {
  VERIFIED: '동일 차수 직접 확정 단가', VERIFIED_FIFO_PURCHASE: '최근 4차수 매입분 기준 선입선출 평가',
  VERIFIED_CATEGORY_AVERAGE: '당차수 총 취득원가를 매입수량으로 나눈 평균단가',
  VERIFIED_CATEGORY_AVERAGE_FALLBACK: '정확한 품목 단가 대신 분류 평균단가로 보충',
  VERIFIED_SALES_PRICE_AUTO: '판매단가 또는 근사 환율을 이용한 자동 추정값(실제 매입원가 확정 아님)',
  VERIFIED_CARRIED_UNIT_COST: '이전 차수 평균단가 이월', VERIFIED_CARRIED_ACQUISITION: '과거 취득원가 이월',
  VERIFIED_SAMPLE_AVERAGE: '다른 검증 품목의 단가로 계산한 샘플 평균',
  VERIFIED_ARRIVAL_COST: '등록된 도착원가', VERIFIED_FREIGHT_ARRIVAL_CALC: '입고·운임·통관 원천으로 재구성한 도착원가',
  VERIFIED_WORKBOOK_CATALOG: '과거 원본 파일의 품목 단가', VERIFIED_HISTORICAL_WORKBOOK: '과거 원본 파일의 재고 금액',
  VERIFIED_MIXED: '서로 다른 단가 근거가 섞인 합계', INPUT_REQUIRED: '단가 근거 부족',
};

export function auditUnitFactor(p) {
  // Match the report's SQL unit contract, not an imagined conversion of historical masters.
  const from = String(p.OutUnit || '').trim(), to = String(p.EstUnit || '').trim();
  if (from && from === to) return 1;
  const factor = from === '박스' && to === '단' ? p.BunchOf1Box
    : from === '박스' && to === '송이' ? p.SteamOf1Box
      : from === '단' && to === '송이' ? p.SteamOf1Bunch : null;
  return finite(factor) > 0 ? Number(factor) : null;
}

function snapshotValuation(master, stockRows, products, priceRows) {
  if (!master) return { status: 'INPUT_REQUIRED', categories: {}, reason: '이 차수의 ProductStock 스냅샷이 없습니다.' };
  const categories = {};
  const byProduct = grouped(stockRows, r => String(r.ProdKey));
  const prices = grouped(priceRows.filter(r => period(r) === period(master)), r => String(r.ProdKey));
  for (const [prodKey, rows] of byProduct) {
    const p = products.get(prodKey);
    if (!p || !p.Stockable) continue;
    const c = categories[p.Category] ||= { knownValue: 0, missingCount: 0, items: [], units: {} };
    const qty = rows.length === 1 ? finite(rows[0].Stock) : null;
    if (qty === 0) continue;
    const factor = auditUnitFactor(p);
    const evidence = prices.get(prodKey) || [];
    const price = evidence.length === 1 && evidence[0].EvidenceStatus === 'VERIFIED'
      && evidence[0].SourceRef && evidence[0].EffectiveAt && evidence[0].ConfirmedBy && evidence[0].ConfirmedAt
      ? finite(evidence[0].Price) : null;
    const complete = qty !== null && factor !== null && price !== null && price >= 0;
    const value = complete ? qty * factor * price : null;
    if (complete) c.knownValue += value; else c.missingCount++;
    if (qty !== null) c.units[p.OutUnit || '단위 미상'] = (c.units[p.OutUnit || '단위 미상'] || 0) + qty;
    c.items.push({ prodKey: Number(prodKey), name: p.DisplayName || p.ProdName, qty, unit: p.OutUnit, factor,
      price, value, status: complete ? 'DIRECT_EVIDENCE' : 'UNVERIFIED',
      reason: qty === null ? '중복/NULL 재고' : factor === null ? '단위 환산 근거 없음'
        : price === null ? '동일 연도·세부차수의 직접 확정 단가 없음. FIFO/평균/이월/판매단가 별도 확인 필요' : '직접 확정 단가로 독립 곱셈',
    });
  }
  for (const c of Object.values(categories)) c.value = c.missingCount ? null : c.knownValue;
  return { status: 'READ', stockKey: master.StockKey, year: String(master.OrderYear), week: master.OrderWeek, categories };
}

export function auditStockRange(source, { year, major }, integrity = {}) {
  const inScope = row => validWeek(row.OrderWeek) && ((String(row.OrderYear) === year && Number(row.OrderWeek.slice(0, 2)) <= Number(major))
    || (String(row.OrderYear) === String(Number(year) - 1) && Number(row.OrderWeek.slice(0, 2)) >= 52));
  const products = new Map(source.products.map(p => [String(p.ProdKey), p]));
  const selectedMaster = row => ((String(row.OrderYear) === year && Number(String(row.OrderWeek).slice(0, 2)) <= Number(major))
    || (String(row.OrderYear) === String(Number(year) - 1) && Number(String(row.OrderWeek).slice(0, 2)) >= 52));
  const masters = source.masters.filter(selectedMaster).sort((a, b) => period(a).localeCompare(period(b)) || a.StockKey - b.StockKey);
  const mastersByPeriod = grouped(masters, period);
  const stocksByKey = grouped(source.stocks, r => Number(r.StockKey));
  const incoming = grouped(source.incoming.filter(inScope), r => `${period(r)}:${r.ProdKey}`);
  const outgoing = grouped(source.outgoing.filter(inScope), r => `${period(r)}:${r.ProdKey}`);
  const adjustments = grouped(source.adjustments.filter(inScope), r => `${period(r)}:${r.ProdKey}`);
  const periods = [...new Set([...masters.map(period), ...source.incoming.filter(inScope).map(period),
    ...source.outgoing.filter(inScope).map(period), ...source.adjustments.filter(inScope).map(period)])].sort();
  const results = new Map();
  let previous = null;
  let chain = new Map();
  let gap = false;
  for (const id of periods) {
    const candidates = mastersByPeriod.get(id) || [];
    const master = candidates.length === 1 ? candidates[0] : null;
    const currentRows = master ? stocksByKey.get(Number(master.StockKey)) || [] : [];
    const prevRows = previous ? stocksByKey.get(Number(previous.StockKey)) || [] : [];
    const currentByProduct = grouped(currentRows, r => String(r.ProdKey));
    const prevByProduct = grouped(prevRows, r => String(r.ProdKey));
    if (master && !validWeek(master.OrderWeek)) {
      results.set(id, { id, master, entries: [], checked: 0, missing: 1, valuation: null });
      previous = master; chain = new Map(); gap = false;
      continue; // Native predecessor can be a legacy backup period. Do not trace a cause across it.
    }
    const entries = [], nextChain = new Map();
    let checked = 0, missing = 0;
    for (const [prodKey, p] of products) {
      if (!p.Stockable || p.isDeleted) continue;
      const k = `${id}:${prodKey}`;
      const ins = incoming.get(k) || [], outs = outgoing.get(k) || [], adj = adjustments.get(k) || [];
      const prev = prevByProduct.get(prodKey) || [], cur = currentByProduct.get(prodKey) || [];
      const relevant = [...prev, ...cur].some(r => finite(r.Stock) !== 0) || ins.length || outs.length || adj.length || chain.has(prodKey);
      if (!relevant) continue;
      const opening = prev.length === 1 ? finite(prev[0].Stock) : null;
      const closing = cur.length === 1 ? finite(cur[0].Stock) : null;
      const inputBad = ins.some(r => finite(r.OutQuantity) === null) || outs.some(r => finite(r.OutQuantity) === null)
        || adj.some(r => finite(r.BeforeValue) === null || finite(r.AfterValue) === null || r.TypeMatches !== 1);
      const receipt = roundQty(sum(ins, r => finite(r.OutQuantity) || 0));
      const shipped = roundQty(sum(outs, r => finite(r.OutQuantity) || 0));
      const adjusted = roundQty(sum(adj, r => ((finite(r.AfterValue) || 0) - (finite(r.BeforeValue) || 0)) * r.TypeMatches));
      const nativePreviousMatches = !master || master.NativePreviousStockKey === undefined
        || (previous && Number(master.NativePreviousStockKey) === Number(previous.StockKey));
      const certain = master && previous && nativePreviousMatches && candidates.length === 1 && opening !== null && closing !== null && !inputBad && !gap;
      const reasons = [];
      if (!master) reasons.push(candidates.length > 1 ? '동일 차수 재고 스냅샷 중복' : '기말 재고 스냅샷 없음');
      if (!previous) reasons.push('비교할 직전 재고 스냅샷 없음');
      if (!nativePreviousMatches) reasons.push('전산이 참조한 직전 스냅샷이 조회 범위 밖이거나 정렬 기준이 다름');
      if (previous && opening === null) reasons.push(prev.length > 1 ? '기초 품목행 중복' : prev.length === 0 ? '기초 품목행 없음' : '기초 수량 NULL');
      if (master && closing === null) reasons.push(cur.length > 1 ? '기말 품목행 중복' : cur.length === 0 ? '기말 품목행 없음' : '기말 수량 NULL');
      if (ins.some(r => finite(r.OutQuantity) === null)) reasons.push('입고 수량 NULL');
      if (outs.some(r => finite(r.OutQuantity) === null)) reasons.push('확정출고 수량 NULL');
      if (adj.some(r => finite(r.BeforeValue) === null || finite(r.AfterValue) === null)) reasons.push('조정 전후 수량 NULL');
      if (adj.some(r => r.TypeMatches !== 1)) reasons.push('조정 코드 중복으로 계산 중복 가능');
      if (gap) reasons.push('앞 구간의 스냅샷 누락으로 연속 추적 불가');
      const expected = certain ? roundQty(opening + receipt - shipped + adjusted) : null;
      const difference = expected === null ? null : roundQty(closing - expected);
      const carried = chain.get(prodKey);
      const openingError = carried?.error ?? 0;
      const closingError = difference === null ? null : roundQty(openingError + difference);
      const origin = carried?.origin || (difference ? id : null);
      if (closingError) nextChain.set(prodKey, { error: closingError, origin });
      const status = !certain ? 'INPUT_REQUIRED' : difference ? 'MISMATCH' : openingError ? 'CARRIED' : 'MATCH';
      if (!certain) missing++; else checked++;
      if (status !== 'MATCH' || adj.length || closing < 0) entries.push({
        prodKey: Number(prodKey), name: p.DisplayName || p.ProdName, category: p.Category, unit: p.OutUnit || '단위 미상',
        period: id, previousPeriod: previous ? period(previous) : null, status, opening, receipt, shipped, adjusted, closing,
        expected, difference, openingError: certain ? openingError : null, closingError, firstObserved: origin,
        adjustmentCount: adj.length, missingReasonCount: adj.filter(r => !String(r.Descr || '').trim()).length,
        explanation: !certain ? `확정 비교 불가: ${reasons.join(' · ')}. 없는 값을 0으로 간주하지 않았습니다.`
          : difference ? `이번 세부차수 계산 잔량 ${format(expected)}${p.OutUnit || ''}과 저장 잔량 ${format(closing)}${p.OutUnit || ''}이 ${format(difference)}만큼 다릅니다. 재계산 미반영·원천 변경 여부를 확인하세요.`
            : openingError ? `이번 입출고 계산은 맞지만, 앞 차수에서 관측된 ${format(openingError)}${p.OutUnit || ''} 차이가 기초재고에 이어져 있습니다.`
              : '조정을 포함한 입출고 식과 저장 잔량이 일치합니다. 조정 자체가 잘못되었다는 뜻은 아닙니다.',
        action: '재고현황의 해당 연도·세부차수에서 입고, DetailFix 확정 출고, 조정 이력을 대조하세요. 이 화면은 자동 보정하지 않습니다.',
      });
    }
    results.set(id, { id, master, previousPeriod: master?.NativePreviousYear && master?.NativePreviousWeek
      ? keyOf(master.NativePreviousYear, master.NativePreviousWeek) : previous ? period(previous) : null,
    entries, checked, missing, valuation: snapshotValuation(master, currentRows, products, source.prices) });
    if (master && currentRows.length) { previous = master; chain = nextChain; gap = false; }
    else { gap = true; chain = new Map(); if (master) previous = master; }
  }
  const latest = (y, m) => masters.filter(r => validWeek(r.OrderWeek) && String(r.OrderYear) === y && r.OrderWeek.slice(0, 2) === m
    && (stocksByKey.get(Number(r.StockKey)) || []).length).sort((a, b) => b.OrderWeek.localeCompare(a.OrderWeek)
      || (stocksByKey.get(Number(b.StockKey)).length - stocksByKey.get(Number(a.StockKey)).length) || b.StockKey - a.StockKey)[0];
  const weeks = Array.from({ length: Number(major) }, (_, i) => {
    const week = String(i + 1).padStart(2, '0');
    const beginYear = i ? year : String(Number(year) - 1), beginWeek = i ? String(i).padStart(2, '0') : '52';
    const begin = latest(beginYear, beginWeek), end = latest(year, week);
    const detail = [...results.values()].filter(r => r.id.startsWith(`${year}/${week}-`));
    const entries = detail.flatMap(r => r.entries);
    const firstNativePeriod = detail.find(r => r.master && validWeek(r.master.OrderWeek))?.previousPeriod;
    const openingPolicyMismatch = Boolean(begin && firstNativePeriod && firstNativePeriod !== period(begin));
    const missing = !begin || !end || openingPolicyMismatch || detail.some(r => !r.master || r.missing);
    return { major: week, status: missing ? 'INPUT_REQUIRED' : entries.some(r => r.status === 'MISMATCH') ? 'MISMATCH'
      : entries.some(r => r.status === 'CARRIED') ? 'CARRIED' : 'MATCH',
      localMismatchCount: entries.filter(r => r.status === 'MISMATCH').length,
      carriedCount: entries.filter(r => r.openingError).length,
      inputRequiredCount: sum(detail, r => r.missing) + (!begin ? 1 : 0) + (!end ? 1 : 0) + (openingPolicyMismatch ? 1 : 0),
      openingPolicyMismatch, firstNativePeriod,
      adjustedCount: entries.filter(r => r.adjustmentCount).length, checkedCount: sum(detail, r => r.checked),
      begin: begin ? results.get(period(begin))?.valuation : null, end: end ? results.get(period(end))?.valuation : null,
      subweeks: detail.map(r => r.id), entries,
    };
  });
  return { version: AUDIT_VERSION, year, major, integrity, weeks,
    invalidKeyCount: masters.filter(r => !validWeek(r.OrderWeek)).length,
    limitations: [
      '일치는 현재 원장의 수량 식 일치입니다. 최초 실사재고·입출고의 실제 발생 사실까지 검증한 것은 아닙니다.',
      '최초 관측 차이는 조회 범위 안에서 찾은 시작점입니다. 전년도52차 이전 원인·삭제 이력은 별도 확인이 필요합니다.',
      '기초재고 과대는 이익을 낮추고, 기말재고 과대는 이익을 높입니다. 단가 증거가 부족하면 금액 영향은 확정하지 않습니다.',
      '가격은 동일 차수의 직접 확정 증거만 독립 곱셈합니다. FIFO·평균·이월·판매단가의 원가 타당성은 별도 확인 대상으로 남깁니다.',
      '전후 원천 지문 일치는 원자적 DB 스냅샷이나 실사 증명이 아닙니다. 과거 환산계수의 변경 이력은 검증하지 못합니다.',
    ] };
}

export function independentProfitMath(row) {
  const auto = row.auto || {}, manual = row.manual || {};
  const pick = k => finite(manual[k]) ?? finite(auto[k]);
  const values = Object.fromEntries(['N', 'L', 'O', 'Q', 'E', 'F'].map(k => [k, finite(auto[k])]));
  for (const k of ['H', 'R', 'S']) values[k] = pick(k);
  for (const k of ['AC', 'AJ']) values[k] = finite(manual[k]) ?? 0;
  const required = ['N', 'L', 'O', 'Q', 'E', 'F', 'H'].filter(k => values[k] === null);
  if ((values.Q || values.S) && values.R === null) required.push('R');
  // An absent forwarding field is zero only when its provenance says freight is included.
  if (values.S === null && row.source?.S === 'cnf_included_in_purchase') values.S = 0;
  if (values.S === null) required.push('S');
  if (required.length) return { status: 'INPUT_REQUIRED', missing: required, values };
  const { N, L, O, Q, E, F, H, S, AC, AJ } = values, R = values.R ?? 0;
  const C = N + L + O + AC, G = (Q + S) * R;
  const I = E + G + H - (row.variant === 'noEnding' ? 0 : F);
  const J = C - I + (row.variant === 'noEnding' ? F : 0) + AJ;
  const denominator = C + (row.variant === 'noEnding' ? F : 0);
  return { status: 'CALCULATED', values: { ...values, C, G, I, J, K: denominator ? J / denominator : null }, denominator };
}

export function auditReportAgainstStock(report, stockWeek, displayedRows = []) {
  const historical = Boolean(report.confirmed) || report.snapshot?.servedFrom === 'snapshot';
  const rows = (report.rows || []).map(row => {
    const math = independentProfitMath(row);
    const displayed = displayedRows.find(r => r.category === row.category)?.calc || row.calc;
    const differences = math.status === 'CALCULATED' && displayed ? ['C', 'G', 'I', 'J', 'K'].filter(k => {
      const a = finite(math.values[k]), b = finite(displayed[k]);
      return a === null || b === null ? a !== b : Math.abs(a - b) > (k === 'K' ? 1e-9 : 0.01);
    }) : [];
    const valuation = ['begin', 'end'].map((side, index) => {
      const label = index ? '기말재고' : '기초재고', col = index ? 'F' : 'E';
      const snap = stockWeek?.[side];
      const evidence = snap?.categories[row.category];
      const reportStock = index ? row.stock : row.beginStock;
      const coordinateMatch = snap && String(report.stockWeeks?.[`${side}OrderYear`]) === snap.year
        && report.stockWeeks?.[side] === snap.week && Number(report.stockWeeks?.[`${side}StockKey`]) === Number(snap.stockKey);
      const adopted = finite(row.auto?.[col]);
      const direct = evidence?.value ?? (snap && !evidence ? 0 : null);
      const source = reportStock?.priceEvidenceStatus || '출처 없음';
      const directPolicy = source === 'VERIFIED';
      const canCompare = !historical && coordinateMatch && direct !== null && adopted !== null && directPolicy;
      const delta = canCompare ? adopted - direct : null;
      return { side, label, adopted, direct, delta, source, missingCount: evidence?.missingCount || 0,
        status: historical ? 'HISTORICAL' : !coordinateMatch ? 'INPUT_REQUIRED' : !canCompare ? 'UNVERIFIED' : Math.abs(delta) > 0.01 ? 'MISMATCH' : 'MATCH',
        explanation: historical ? `이 보고서의 평가 방식은 ${priceNames[source] || '출처 미확인'}입니다. 확정본/계산 저장본과 현재 원장은 시점이 달라 직접 오류 판정하지 않습니다.`
          : !coordinateMatch ? '보고서와 독립 조회의 재고 연도·차수·StockKey가 다르거나 없습니다. 같은 기준으로 다시 조회해야 합니다.'
            : !directPolicy ? `현재 보고서는 ${priceNames[source] || '별도 평가 근거'}을 사용합니다. 이 검산에서 해당 원가 증빙까지 독립 확인한 것은 아닙니다. 수량 차이와 단가 추정을 구분하세요.`
              : direct === null ? '직접 확정 단가 또는 단위 환산 근거가 빠진 품목이 있어 전체 평가액을 독립 확정할 수 없습니다.'
                : Math.abs(delta || 0) > 0.01 ? `${label} 보고서 금액과 수량×직접 확정 단가 합계가 다릅니다.` : '같은 스냅샷 수량×직접 확정 단가 합계가 보고서 금액과 일치합니다.',
        items: evidence?.items || [],
      };
    });
    const beforeInventory = math.status === 'CALCULATED' ? math.values.C - math.values.G - math.values.H + math.values.AJ : null;
    const inventoryEffect = math.status === 'CALCULATED' ? math.values.F - math.values.E : null;
    const cause = beforeInventory === null ? '필수 입력값이 빠져 이익 원인을 금액으로 확정할 수 없습니다.'
      : `재고를 빼고 보면 매출에서 상품·항공료·통관비를 차감한 손익(이익조정 포함)은 ${format(beforeInventory)}원입니다. `
        + `기말재고에서 기초재고를 뺀 효과 ${format(inventoryEffect)}원이 더해져 최종 이익 ${format(math.values.J)}원이 됩니다. `
        + (math.values.J < 0 && beforeInventory >= 0 ? '즉, 계산상 이익을 음수로 바꾼 직접 요인은 기초재고액이 기말재고액보다 큰 점입니다. 이것이 실제 재고 소진인지, 수량 차이인지, 추정 단가 영향인지는 아래 판정을 함께 봐야 합니다.'
          : math.values.J < 0 ? '상품·항공료·통관비만으로도 매출보다 비용이 큽니다. 재고뿐 아니라 매출 누락·원가 귀속도 확인해야 합니다.'
            : '이익이 양수여도 재고 수량과 단가 근거가 정확하다는 뜻은 아닙니다.');
    return { category: row.category, math, differences, mathStatus: math.status !== 'CALCULATED' ? math.status
      : !displayed ? 'NOT_COMPARED' : differences.length ? 'MISMATCH' : 'MATCH', valuation,
      cause,
      quantityIssues: (stockWeek?.entries || []).filter(r => r.category === row.category && (r.status !== 'MATCH' || r.closing < 0)),
      explanation: math.status !== 'CALCULATED' ? `독립 계산에 필요한 ${math.missing.map(k => fieldNames[k] || k).join(', ')} 값이 없습니다. 화면이 0으로 계산했더라도 정확한 이익으로 인정하지 않습니다.`
        : `매출 ${format(math.values.C)}원 − 기초 ${format(math.values.E)}원 − 상품·항공료 ${format(math.values.G)}원 − 통관비 ${format(math.values.H)}원 + 기말 ${format(math.values.F)}원 + 이익조정 ${format(math.values.AJ)}원 = 이익 ${format(math.values.J)}원. 이익률 분모는 ${format(math.denominator)}원입니다.`,
    };
  });
  const included = rows.filter(r => r.category !== '기타(미분류)');
  const complete = included.length && included.every(r => r.math.status === 'CALCULATED');
  const totals = complete ? included.reduce((acc, r) => ({ C: acc.C + r.math.values.C, F: acc.F + r.math.values.F, J: acc.J + r.math.values.J }), { C: 0, F: 0, J: 0 }) : null;
  if (totals) totals.K = totals.C + totals.F ? totals.J / (totals.C + totals.F) : null;
  return { rows, totals, historical, note: '산술 일치, 수량 일치, 단가 근거 확인은 서로 다른 판정입니다. 어느 하나만 맞아도 전체 수익률이 검증된 것은 아닙니다.' };
}
