// Read-only explanatory model. This never changes the existing profit report formula.
export const MODEL_VERSION = 'product-wac-customer-v1';
const n = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const sum = (rows, key) => rows.reduce((s, r) => s + (n(r[key]) ?? 0), 0);
const close = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-7);
export function normalizeMarginUnit(value) {
  const text = String(value || '').trim().toUpperCase();
  return ({ BOX: '박스', BUNCH: '단', STEM: '송이', STEAM: '송이', EA: '송이' })[text] || text;
}
export function parseMarginScope(year, week) {
  if (typeof year !== 'string' || !/^20\d{2}$/.test(year) || typeof week !== 'string' || !/^(?:0?[1-9]|[1-4]\d|5[0-3])$/.test(week)) {
    const error = new Error('연도와 대차수를 명시해 주세요 (예: 2026, 39).');
    error.statusCode = 400; throw error;
  }
  return { year, major: week.padStart(2, '0') };
}
export function marginUnitFactor(product, from, to) {
  from = normalizeMarginUnit(from); to = normalizeMarginUnit(to);
  if (!['박스', '단', '송이'].includes(from) || !['박스', '단', '송이'].includes(to)) return null;
  if (from === to) return 1;
  const bunch = n(product.BunchOf1Box), stem = n(product.SteamOf1Box), perBunch = n(product.SteamOf1Bunch);
  const units = { 박스: 1, 단: bunch > 0 ? bunch : null, 송이: stem > 0 ? stem : null };
  if (units[from] > 0 && units[to] > 0) return units[to] / units[from];
  if (from === '단' && to === '송이' && perBunch > 0) return perBunch;
  if (from === '송이' && to === '단' && perBunch > 0) return 1 / perBunch;
  return null;
}

export function completeReceiptCoverage(evidence, expectedLineKeys, expectedQuantity) {
  const c=evidence?.receiptCoverage;
  if(!c || !Array.isArray(c.lineKeys) || !Array.isArray(c.allLineKeys) || c.units?.length!==1) return false;
  const expected=[...expectedLineKeys].map(Number).sort((a,b)=>a-b);
  const actual=c.lineKeys.map(Number).sort((a,b)=>a-b);
  const all=c.allLineKeys.map(Number).sort((a,b)=>a-b);
  return expected.every(k=>Number.isInteger(k)&&k>0) && new Set(expected).size===expected.length
    && actual.length===expected.length && new Set(actual).size===actual.length
    && JSON.stringify(actual)===JSON.stringify(expected) && JSON.stringify(all)===JSON.stringify(expected)
    && Number(c.inputRowCount)===expected.length && Number(c.pricedRowCount)===expected.length
    && [c.quantity,c.fullQuantity,c.pricedQuantity].every(q=>n(q)!=null && close(Number(q),expectedQuantity));
}

/** Each period's quantities are already converted to the SAME product EstUnit.
 * A real zero snapshot is an anchor; an absent whole snapshot is never zero.
 * Negative adjustments consume this period's WAC but are NOT customer sales costs.
 */
export function reconstructProductCost({ product, periods, targetMajor, orderYear }) {
  let known = false, openingQuantity = null, openingAmount = null, previousMajor = null;
  let estimated = false, sourceRefs = [], reasons = ['검증된 기초재고 원가 또는 0 재고 기준점 없음'];
  let answer;
  const targetYears=[...new Set(periods.filter(p=>Number(p.major)===Number(targetMajor)).map(p=>String(p.year)))];
  const targetYear=orderYear??(targetYears.length===1?targetYears[0]:null);
  for (const p of periods.filter(p=>String(p.year)===String(targetYear)).sort((a, b) => Number(a.major) - Number(b.major))) {
    if (Number(p.major) > Number(targetMajor)) break;
    const isTarget = Number(p.major) === Number(targetMajor);
    const q = n(p.receiptQuantity), value = n(p.receiptAmount), end = n(p.endQuantity);
    const currentReasons = [];
    if (previousMajor != null && Number(p.major) !== Number(previousMajor) + 1) { known = false; reasons = ['재고 스냅샷 차수 연속성 누락']; }
    if (!known) currentReasons.push(...reasons);
    if (!p.snapshotExists) currentReasons.push('차수 전체 재고 스냅샷 없음');
    if (p.unitKnown === false) currentReasons.push('품목 물리 단위 환산 근거 불일치');
    if (p.duplicateStock) currentReasons.push('같은 재고 스냅샷의 품목 중복행');
    if (openingQuantity != null && openingQuantity < 0) currentReasons.push('기초 음수재고');
    if (end != null && end < 0) currentReasons.push('기말 음수재고');
    if (p.hasPositiveAdjustment) currentReasons.push('양수 재고조정의 취득원가 근거 없음');
    if (q == null || q < 0 || !p.receiptComplete || value == null || value < 0) currentReasons.push('입고 도착원가·환율·수량 전체 근거 부족');
    if(!p.receiptComplete) currentReasons.push(...(p.receiptReasons||[]));
    const balanced = openingQuantity != null && end != null && q != null && n(p.shipQuantity) != null && n(p.adjustmentQuantity) != null
      && close(openingQuantity + q - p.shipQuantity + p.adjustmentQuantity, end);
    if (known && !balanced) currentReasons.push('원시 수량 대사 차이(전산 세부차수 ROUND2 추가 검산 필요)');
    const available = openingQuantity == null || q == null ? null : openingQuantity + q;
    const totalValue = openingAmount == null || value == null ? null : openingAmount + value;
    const complete = known && currentReasons.length === 0 && available > 0 && totalValue >= 0;
    const unitCost = complete ? totalValue / available : null;
    if (p.estimated) estimated = true;
    sourceRefs = [...new Set([...sourceRefs, ...(p.sourceRefs || [])])];
    if (isTarget) answer = {
      prodKey: product.ProdKey, unit: normalizeMarginUnit(product.EstUnit), openingQuantity, openingAmount,
      receiptQuantity: q, receiptAmount: p.receiptComplete ? value : null, endQuantity: end,
      shipQuantity: p.shipQuantity, adjustmentQuantity: p.adjustmentQuantity, unitCost,
      status: unitCost == null ? 'MISSING' : estimated ? 'ESTIMATED' : 'VERIFIED',
      source: unitCost == null ? null : 'PRODUCT_PERIOD_WEIGHTED_AVERAGE',
      estimated, reasons: [...new Set(currentReasons.length ? currentReasons : available === 0 ? ['판매 가능 재고 수량 0'] : [])],
      reason: currentReasons[0] || null, sourceRefs, balanced,
    };
    // A real, existing zero snapshot can restart evidence WITHOUT inventing a historical price.
    if (p.snapshotExists && end === 0 && p.unitKnown !== false && !p.duplicateStock) {
      known = true; openingQuantity = 0; openingAmount = 0; reasons = []; estimated = false;
      sourceRefs = [`ProductStock:${product.ProdKey}:${p.year}:${p.major}:zero-anchor`];
    } else if (complete && end >= 0) {
      known = true; openingQuantity = end; openingAmount = end * unitCost; reasons = [];
    } else {
      known = false; openingQuantity = p.snapshotExists ? end : null; openingAmount = null;
      reasons = currentReasons.length ? currentReasons : ['이전 차수 재고 평가 근거 부족'];
    }
    previousMajor = p.major;
  }
  return answer || { prodKey: product.ProdKey, unit: normalizeMarginUnit(product.EstUnit), unitCost: null,
    openingQuantity: null, openingAmount: null, receiptQuantity: null, receiptAmount: null,
    status: 'MISSING', source: null, reasons: ['선택 차수 재고 스냅샷 없음'], reason: '선택 차수 재고 스냅샷 없음' };
}

export function marginMetrics(rows = []) {
  const positive = rows.filter(r => r.kind === 'N' && r.quantity > 0 && n(r.amount)!=null && r.amount >= 0 && r.unit);
  const allSales = rows.filter(r => r.kind === 'N');
  const missingAmount=rows.filter(r=>n(r.amount)==null),missingVat=rows.filter(r=>r.vatMissing===true);
  const missingQuantity=allSales.filter(r=>n(r.quantity)==null),missingPhysical=allSales.filter(r=>n(r.physicalQuantity)==null);
  const missing = positive.filter(r => n(r.unitCost) == null || n(r.physicalQuantity) == null || r.physicalQuantity < 0);
  const exceptional = allSales.filter(r => !(r.quantity > 0 && n(r.amount)!=null && r.amount >= 0 && r.unit));
  const priced = positive.filter(r => !missing.includes(r));
  const knownCostAmount = priced.reduce((s, r) => s + r.physicalQuantity * r.unitCost, 0);
  const knownNetSales=sum(rows,'amount'),netSales = missingAmount.length?null:knownNetSales, quantity = missingQuantity.length?null:sum(allSales, 'quantity'), positiveQuantity = sum(positive, 'quantity');
  const positiveSales = sum(positive, 'amount'), positiveVat = sum(positive, 'vat');
  const costComplete = !missing.length && !exceptional.length && !missingAmount.length && !missingVat.length && positive.length > 0;
  const costAmount = costComplete ? knownCostAmount : null;
  const marginAmount = costAmount == null ? null : netSales - costAmount;
  const signedSales=kind=>rows.some(r=>r.kind===kind&&n(r.amount)==null)?null:sum(rows.filter(r=>r.kind===kind),'amount');
  return { quantity, positiveQuantity, physicalQuantity: missingPhysical.length?null:sum(positive, 'physicalQuantity'), netSales,knownNetSales,
    shipmentSales: signedSales('N'), badDeduction: signedSales('L'),
    otherSales: signedSales('O'), vat: missingVat.length?null:sum(rows, 'vat'),
    avgNetPrice: positiveQuantity > 0 && !missingQuantity.length && !allSales.some(r=>n(r.amount)==null) ? positiveSales / positiveQuantity : null,
    avgGrossPrice: positiveQuantity > 0 && !missingQuantity.length && !missingAmount.length && !missingVat.length ? (positiveSales + positiveVat) / positiveQuantity : null,
    costAmount, knownCostAmount, marginAmount, marginPct: marginAmount != null && netSales > 0 ? marginAmount / netSales : null,
    quantityShare: null, revenueShare: null,
    coverage: { knownSales: sum(priced, 'amount'), totalSales: allSales.some(r=>n(r.amount)==null)?null:positiveSales,
      missingAmountRows:missingAmount.length,missingVatRows:missingVat.length,
      missingQuantityRows:missingQuantity.length,missingPhysicalRows:missingPhysical.length,
      unknownProducts: [...new Set(missing.map(r => r.prodKey))], exceptionalRows: exceptional.length,
      exceptionalSales: sum(exceptional, 'amount'), exceptionalQuantity: sum(exceptional, 'quantity'),
      positiveQuantityMissingAmount:sum(allSales.filter(r=>r.quantity>0&&n(r.amount)==null),'quantity') },
    warnings: [...new Set([
      ...(missing.length ? ['원가 근거가 없는 품목이 있어 전체 판매마진 미확정'] : []),
      ...(exceptional.length ? ['0·음수 수량/금액 또는 단위 누락 거래를 별도 합계에 포함'] : []),
      ...(missingAmount.length||missingVat.length?['NULL 금액·부가세는 정상 0원과 구분하며 전체 평균/판매마진을 확정하지 않습니다.']:[]),
      ...(positive.some(r => r.estimated) ? ['승인 추정 통관비가 포함된 원가'] : []),
      ...(positive.some(r => n(r.physicalQuantity) != null && !close(r.quantity, r.physicalQuantity)) ? ['견적 수량과 실제 소모 수량 차이: 판매단가와 원가의 수량 기준을 구분'] : []),
    ])],
  };
}

export function buildCustomerMarginGroups({ currentRows, previousRows, currentCosts = {}, previousCosts = {}, decompose }) {
  const enrich = (rows, costs) => rows.map(r => ({ ...r, unit: normalizeMarginUnit(r.unit),
    unitCost: costs[r.prodKey]?.unitCost ?? null, estimated: costs[r.prodKey]?.estimated === true }));
  const current = enrich(currentRows, currentCosts), previous = enrich(previousRows, previousCosts);
  const keyOf = r => JSON.stringify([r.category || '미분류', r.country || '', r.flower || '', r.unit || '단위미상']);
  const groups = new Map();
  for (const r of [...current, ...previous]) if (!groups.has(keyOf(r))) groups.set(keyOf(r), r);
  const metricPair = (cr, pr) => ({ current: marginMetrics(cr), previous: marginMetrics(pr) });
  const driverRows = rows => rows.filter(r => r.kind === 'N' && r.quantity > 0 && n(r.amount)!=null && r.amount >= 0 && r.unit).map(r => ({
    prodKey: r.prodKey, custKey: r.custKey, unit: r.unit, quantity: r.quantity, netSales: r.amount, unitCost: r.unitCost,
  }));
  return [...groups].map(([key, sample]) => {
    const cr = current.filter(r => keyOf(r) === key), pr = previous.filter(r => keyOf(r) === key);
    const pair = metricPair(cr, pr);
    const customerIds = [...new Set([...cr, ...pr].map(r => r.custKey))];
    const productIds = [...new Set([...cr, ...pr].map(r => r.prodKey))];
    const products = productIds.map(prodKey => {
      const rows = [...cr, ...pr].filter(r => r.prodKey === prodKey);
      return { prodKey, productName: rows[0]?.productName || '(품목 없음)', unit: sample.unit,
        ...metricPair(cr.filter(r => r.prodKey === prodKey), pr.filter(r => r.prodKey === prodKey)),
        costBasis: currentCosts[prodKey] || null, previousCostBasis: previousCosts[prodKey] || null };
    });
    const customers = customerIds.map(custKey => {
      const cc = cr.filter(r => r.custKey === custKey), pc = pr.filter(r => r.custKey === custKey);
      const cp = metricPair(cc, pc);
      for (const side of ['current', 'previous']) {
        cp[side].quantityShare = pair[side].positiveQuantity > 0 ? cp[side].positiveQuantity / pair[side].positiveQuantity : null;
        cp[side].revenueShare = pair[side].netSales != null && pair[side].netSales !== 0 && cp[side].netSales!=null ? cp[side].netSales / pair[side].netSales : null;
      }
      return { custKey, custName: [...cc, ...pc][0]?.custName || '(업체 없음)', ...cp,
        products: [...new Set([...cc, ...pc].map(r => r.prodKey))].map(prodKey => ({
          prodKey, productName: [...cc, ...pc].find(r => r.prodKey === prodKey)?.productName,
          unit: sample.unit, ...metricPair(cc.filter(r => r.prodKey === prodKey), pc.filter(r => r.prodKey === prodKey)),
        })) };
    });
    return { key, category: sample.category || '미분류', country: sample.country, flower: sample.flower,
      unit: sample.unit || '단위미상', kinds:[...new Set([...cr,...pr].map(r=>r.kind))], ...pair, customers, products,
      drivers: decompose ? decompose({ previous: driverRows(pr), current: driverRows(cr),
        previousMargin: pair.previous.marginAmount, currentMargin: pair.current.marginAmount }) : null };
  });
}
