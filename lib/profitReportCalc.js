// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export const VERIFIED_STOCK_PRICE_EVIDENCE_STATUSES = Object.freeze([
  'VERIFIED',
  'VERIFIED_ARRIVAL_COST',
  'VERIFIED_FREIGHT_ARRIVAL_CALC',
  'VERIFIED_CARRIED_ACQUISITION',
  'VERIFIED_MIXED',
  'VERIFIED_CATEGORY_AVERAGE',
  'VERIFIED_SAMPLE_AVERAGE',
  'VERIFIED_HISTORICAL_WORKBOOK',
  'VERIFIED_WORKBOOK_CATALOG',
  // 2026-08-26 사장님 방침 "근거 없으면 0이 아니라 원본공식으로": 품목별 검증 근거가 없을 때
  // 카테고리 평균원가 공식을 전 카테고리 fallback으로, 매입 없는 주는 전차수 단가 이월로 채운다.
  // 정확 근거보다 항상 후순위이며 화면에는 별도 원천으로 구분 표시된다.
  'VERIFIED_CATEGORY_AVERAGE_FALLBACK',
  'VERIFIED_CARRIED_UNIT_COST',
  // 2026-08-27 사장님 확정 "재고 매입단가는 판매단가 기준 자동처리": 검증 근거가 전무한
  // 품목만 최근 확정 판매단가(×1.1)→최근 매입 근사 순으로 자동 평가(26~31차 백테스트
  // 오차율 7.3%). 근거 저장 시 항상 대체되며 화면·감사에 자동평가로 구분 표시된다.
  'VERIFIED_SALES_PRICE_AUTO',
]);

// 28차 원본 workbook에서 F 수식이 명시적으로 확인된 카테고리들이다.
// F = (G + H) / 해당 카테고리 매입수량 * 마지막 ProductStock 환산수량.
// 다른 국가의 품목별 원가 평가까지 이 공식을 확대하지 않는다.
export const CATEGORY_AVERAGE_INVENTORY_KEYS = Object.freeze([
  '콜롬비아 수국',
  '콜롬비아 카네이션',
  '콜롬비아 장미',
  '콜롬비아 루스커스',
  '콜롬비아 알스트로',
  '베트남',
]);

const normalizeSampleAverageUnit = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (['BOX', '박스'].includes(raw)) return 'BOX';
  if (['BUNCH', '단'].includes(raw)) return 'BUNCH';
  if (['STEM', 'STEAM', '송이', '스팀', '대'].includes(raw)) return 'STEM';
  return raw;
};

/** 이름에 명시된 샘플 품목만 평균 보완 대상으로 본다. */
export function isSampleInventoryProduct(input = {}) {
  const names = typeof input === 'string'
    ? [input]
    : [input.prodName, input.ProdName, input.displayName, input.DisplayName];
  return names.some((name) => /샘플|sample/i.test(String(name || '')));
}

/**
 * 같은 ProductStock 스냅샷 안의 샘플 품목 단가 보완값을 만든다.
 * 호출자는 각 행에 명시적 scopeKey(연도+차수+StockKey)를 전달해야 하며, 이 함수는
 * scopeKey와 정규화 단위가 모두 같은 비샘플 검증단가만 수량 절대값으로 가중평균한다.
 * 같은 카테고리+단위를 먼저 쓰고, 없을 때만 같은 scope의 전체 카테고리 동일 단위를 쓴다.
 */
export function sampleInventoryAveragePriceSuggestions(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const rowKey = String(row?.rowKey ?? row?.prodKey ?? index);
    const scopeKey = String(row?.scopeKey || '');
    const category = String(row?.category || '');
    const unit = normalizeSampleAverageUnit(row?.unit);
    const qty = Math.abs(Number(row?.qty || 0));
    const price = row?.price == null ? null : Number(row.price);
    return {
      ...row,
      rowKey,
      scopeKey,
      category,
      unit,
      qty,
      price: Number.isFinite(price) && price > 0 ? price : null,
      priceSource: String(row?.priceSource || ''),
      isSample: row?.isSample === true || isSampleInventoryProduct(row),
    };
  });
  // 재고는 매입원가로 평가한다. 판매·분배단가는 금액이 존재하더라도 peer가 될 수 없다.
  // 호출부가 정확한 취득원가에 아래 상태를 붙여 전달해야만 샘플 평균에 참여한다.
  const verifiedAcquisitionSources = new Set([
    'VERIFIED_EXACT',
    'VERIFIED_EVIDENCE',
    'VERIFIED_ARRIVAL_COST',
    'VERIFIED_CARRIED_ACQUISITION',
    'VERIFIED_WORKBOOK_CATALOG',
  ]);
  const peers = normalized.filter((row) => !row.isSample && row.scopeKey && row.unit
    && row.qty > 0 && row.price != null && verifiedAcquisitionSources.has(row.priceSource));
  const weighted = (items) => {
    const weight = items.reduce((sum, row) => sum + row.qty, 0);
    if (!(weight > 0)) return null;
    return {
      price: items.reduce((sum, row) => sum + row.price * row.qty, 0) / weight,
      peerCount: items.length,
      totalWeight: weight,
      peerRowKeys: items.map((row) => row.rowKey),
      peerSources: [...new Set(items.map((row) => row.priceSource).filter(Boolean))],
    };
  };
  const suggestions = {};
  for (const row of normalized) {
    if (!row.isSample || row.price != null || !row.scopeKey || !row.unit) continue;
    const sameCategory = peers.filter((peer) => peer.scopeKey === row.scopeKey
      && peer.unit === row.unit && peer.category === row.category);
    const sameUnit = sameCategory.length ? sameCategory : peers.filter((peer) => peer.scopeKey === row.scopeKey && peer.unit === row.unit);
    const average = weighted(sameUnit);
    if (!average) continue;
    suggestions[row.rowKey] = {
      ...average,
      status: 'VERIFIED_SAMPLE_AVERAGE',
      basis: sameCategory.length
        ? 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_CATEGORY_UNIT'
        : 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_UNIT',
      scopeKey: row.scopeKey,
      unit: row.unit,
    };
  }
  return suggestions;
}

/** 32-02, 32-2처럼 저장된 차수를 같은 숫자 순서로 비교한다. */
export function profitReportOrderWeekRank(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

/**
 * 이전에 사용자가 검증한 매입원가를 후속 재고 스냅샷에 이어 쓰는 순수 정책 함수.
 *
 * - 같은 연도·같은 품목·같은 매입단위만 허용한다.
 * - 대상 스냅샷보다 앞선 근거만 사용한다.
 * - 근거 이후 새 매입이 있으면 해당 매입의 새 원가가 필요하므로 이어 쓰지 않는다.
 * - 판매·분배단가와 과거 workbook catalog는 후보로 받을 수 없다.
 */
export function selectCarriedAcquisitionPriceEvidence({
  targetYear,
  targetWeek,
  products = [],
  candidates = [],
  purchases = [],
} = {}) {
  const year = String(targetYear || '');
  const targetRank = profitReportOrderWeekRank(targetWeek);
  if (!/^\d{4}$/.test(year) || targetRank == null) return {};
  const allowedSources = new Set(['VERIFIED_EVIDENCE', 'VERIFIED_ARRIVAL_COST']);
  const productUnits = new Map((products || []).map((item) => [
    String(item.prodKey ?? item.ProdKey),
    normalizeSampleAverageUnit(item.unit ?? item.EstUnit),
  ]));
  const latestPurchaseRank = new Map();
  for (const row of purchases || []) {
    if (String(row.orderYear ?? row.OrderYear) !== year) continue;
    const prodKey = String(row.prodKey ?? row.ProdKey);
    const rank = profitReportOrderWeekRank(row.orderWeek ?? row.OrderWeek);
    if (!prodKey || rank == null || rank > targetRank) continue;
    latestPurchaseRank.set(prodKey, Math.max(latestPurchaseRank.get(prodKey) ?? -Infinity, rank));
  }
  const eligible = [];
  for (const row of candidates || []) {
    const prodKey = String(row.prodKey ?? row.ProdKey);
    const rowYear = String(row.orderYear ?? row.OrderYear);
    const rowWeek = String(row.orderWeek ?? row.OrderWeek);
    const rank = profitReportOrderWeekRank(rowWeek);
    const source = String(row.source || '');
    const price = Number(row.price ?? row.Price);
    const unit = normalizeSampleAverageUnit(row.unit ?? row.Unit);
    if (!prodKey || rowYear !== year || rank == null || rank >= targetRank) continue;
    if (!allowedSources.has(source) || !(price > 0)) continue;
    if (!unit || unit !== productUnits.get(prodKey)) continue;
    if ((latestPurchaseRank.get(prodKey) ?? -Infinity) > rank) continue;
    eligible.push({ ...row, prodKey, rowWeek, rank, source, price, unit });
  }
  const sourcePriority = { VERIFIED_EVIDENCE: 2, VERIFIED_ARRIVAL_COST: 1 };
  eligible.sort((a, b) => b.rank - a.rank
    || (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0)
    || String(b.confirmedAt || '').localeCompare(String(a.confirmedAt || '')));
  const result = {};
  for (const row of eligible) {
    if (result[row.prodKey]) continue;
    result[row.prodKey] = {
      price: row.price,
      source: 'VERIFIED_CARRIED_ACQUISITION',
      sourceWeek: row.rowWeek,
      sourceRefs: [
        ...(Array.isArray(row.sourceRefs) ? row.sourceRefs : [row.sourceRef].filter(Boolean)),
        `carry-forward:${year}:${row.rowWeek}->${targetWeek}:prod-${row.prodKey}`,
      ],
      confirmedAt: row.confirmedAt || null,
    };
  }
  return result;
}

/**
 * exact 재고단가 근거 선택 정책 — 순수 함수(DB 의존 없음).
 * 우선순위: 사용자 확정 도착원가(arrival) > 같은 세부차수 전산 계산 도착원가(freightArrival)
 *   > 취득원가 산식이 입증된 workbook catalog template(catalogEvidence) > 이월 근거(carried).
 * catalog는 과거 workbook 값이므로 같은 차수의 실제 계산된 전산 도착원가가 있으면 항상 그 뒤로 밀린다.
 * 두 독립 감사에서 확정: 기존 `arrival || catalogEvidence || freightArrival || carried` 순서는
 * 과거 catalog가 같은 세부차수의 실제 계산 도착원가보다 먼저 선택되는 결함이었다.
 */
export function selectStockPriceEvidence({ arrival, freightArrival, catalogEvidence, carried } = {}) {
  return arrival || freightArrival || catalogEvidence || carried || null;
}

/** 원본 매출원가 workbook의 카테고리 평균원가 재고평가식.
 * 외화 매입/포워딩이 있으면 정확한 당주 과세환율이 반드시 있어야 한다. */
export function computeCategoryAverageInventoryValue(input = {}, options = {}) {
  // anyCategory: 품목별 검증 근거가 전무한 카테고리의 fallback 경로(2026-08-26) —
  // workbook에 수식이 확인된 6키가 아니어도 같은 공식으로 근사치를 만든다.
  if (options.anyCategory !== true
    && !CATEGORY_AVERAGE_INVENTORY_KEYS.includes(String(input.category || ''))) return null;
  const purchaseQty = Number(input.purchaseQty);
  const stockQty = Number(input.stockQty);
  const purchaseForeign = Number(input.purchaseForeign || 0);
  const forwardingForeign = Number(input.forwardingForeign || 0);
  const customsCost = Number(input.customsCost || 0);
  const taxableRate = input.taxableRate == null ? null : Number(input.taxableRate);
  if (!(purchaseQty > 0) || !Number.isFinite(stockQty)) return null;
  if ((Math.abs(purchaseForeign) > 0.000001 || Math.abs(forwardingForeign) > 0.000001)
    && !(Number.isFinite(taxableRate) && taxableRate > 0)) return null;
  const goodsAndForwarding = (purchaseForeign + forwardingForeign) * Number(taxableRate || 0);
  const unitCost = (goodsAndForwarding + customsCost) / purchaseQty;
  if (!Number.isFinite(unitCost)) return null;
  return { value: unitCost * stockQty, unitCost };
}

export function hasVerifiedStockPriceEvidence(stock) {
  return VERIFIED_STOCK_PRICE_EVIDENCE_STATUSES.includes(String(stock?.priceEvidenceStatus || ''));
}

/** E/F는 EXE가 계산한 ProductStock 수량과 동일 범위에서 검증된 단가 근거만 사용한다.
 * snapshotConfirmed는 기존 API 호환 이름이며 StockMaster.isFix가 아니라 ProductStock 스냅샷 존재를 뜻한다. */
export function computeAutoEndingStock(stock) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty === 0 && stock.snapshotConfirmed === true) return 0;
  if (stock.snapshotConfirmed !== true || !hasVerifiedStockPriceEvidence(stock)) return null;
  return stock.evidenceValue == null ? null : Number(stock.evidenceValue);
}

/** 화면·감사에 채택된 재고 원천 또는 누락 원인을 그대로 표시한다. */
export function endingStockSourceKind(stock) {
  if (!stock || stock.snapshotConfirmed !== true) return 'missing_stock_snapshot';
  if (n0(stock.endQty) === 0) return 'no_stock';
  if (!hasVerifiedStockPriceEvidence(stock) || stock.evidenceValue == null) return 'missing_price_evidence';
  if (stock.priceEvidenceStatus === 'VERIFIED_ARRIVAL_COST') return 'verified_arrival_cost';
  if (stock.priceEvidenceStatus === 'VERIFIED_FREIGHT_ARRIVAL_CALC') return 'verified_freight_arrival_calc';
  if (stock.priceEvidenceStatus === 'VERIFIED_CARRIED_ACQUISITION') return 'verified_carried_acquisition_cost';
  if (stock.priceEvidenceStatus === 'VERIFIED_MIXED') return 'verified_mixed_price_evidence';
  if (stock.priceEvidenceStatus === 'VERIFIED_CATEGORY_AVERAGE') return 'verified_category_average';
  if (stock.priceEvidenceStatus === 'VERIFIED_SAMPLE_AVERAGE') return 'verified_sample_average';
  if (stock.priceEvidenceStatus === 'VERIFIED_HISTORICAL_WORKBOOK') return 'verified_historical_workbook';
  if (stock.priceEvidenceStatus === 'VERIFIED_WORKBOOK_CATALOG') return 'verified_workbook_inventory_catalog';
  if (stock.priceEvidenceStatus === 'VERIFIED_CATEGORY_AVERAGE_FALLBACK') return 'category_average_fallback';
  if (stock.priceEvidenceStatus === 'VERIFIED_CARRIED_UNIT_COST') return 'carried_category_unit_cost';
  if (stock.priceEvidenceStatus === 'VERIFIED_SALES_PRICE_AUTO') return 'sales_price_auto';
  return 'verified_product_stock_price';
}

export function computeProfitRow(row, edits = {}) {
  const e = edits[row.category] || {};
  const pick = (col, fallback) => {
    const ev = e[col];
    if (ev !== undefined) return ev === '' ? fallback : Number(ev); // 빈칸은 수기 override 해제 → 자동값 즉시 복귀
    const mv = row.manual[col];
    if (mv != null) return Number(mv);
    return fallback;
  };
  const N = row.auto.N, L = row.auto.L, O = row.auto.O, Q = row.auto.Q;
  // R 과세환율: 당주 입력·저장값 > 서버가 검증한 정확한 차수 원천.
  // CurrencyMaster 현재값은 참고 제안일 뿐 자동 계산에 사용하지 않는다. 전차수 값은 API가
  // 현재 차수에 매입이 없음을 검증한 경우에만 제한적으로 auto.R에 넘긴다.
  const R = pick('R', row.auto.R ?? null);
  // H 그외통관비: 입력·저장값 > 그외통관비/포워딩 입력 화면에서 계산된 자동값(2026-07-10)
  const H = pick('H', row.auto.H ?? null);
  const S = pick('S', row.auto.S || null);
  // E/F 최종값은 서버가 검증한 ProductStock+시점단가 결과만 허용한다.
  const E = row.auto.E ?? null;
  const F = computeAutoEndingStock(row.stock) ?? row.auto.F ?? null;
  // 차수귀속 조정(2026-08-26 사장님 방침 "동일 상황엔 엑셀같이 처리") — 원본 엑셀이 하던
  // 두 가지 수동 조정을 웹에서도 근거와 함께 입력한다. 자동값은 없고 수기만 존재한다.
  //   AC 매출조정: 다른 차수 귀속 매출을 이 차수 매출(C)로 가감 — C와 J에 함께 반영
  //   AJ 이익조정: 매출은 그대로 두고 이익(J)만 가감 — 원본 30↔31차 J셀 직접 수정과 동일
  const AC = pick('AC', null);
  const AJ = pick('AJ', null);
  const C = N + L + O + n0(AC);
  const P = Q * n0(R);
  const T = n0(S) * n0(R);
  const G = P + T;
  const noEnd = row.variant === 'noEnding';
  const I = noEnd ? n0(E) + G + n0(H) : n0(E) + G + n0(H) - n0(F);
  const J = (noEnd ? C - I + n0(F) : C - I) + n0(AJ);
  const K = noEnd ? (C + n0(F) !== 0 ? J / (C + n0(F)) : null) : (C !== 0 ? J / C : null);
  const M = C !== 0 ? -(L / C) : null;
  return { N, L, O, Q, E, F, H, R, S, C, P, T, G, I, J, K, M, AC, AJ };
}

/** 매출비율(D) — row.C / totals.C. 분모(totals.C)는 공제를 포함하고 기타(미분류)는 제외한다
 * (원본 엑셀 본표에는 미분류 행 자체가 없다 — computeProfitTotals 주석 참고).
 * 합계가 0이면 빈칸(null). pages/sales/profit-report.js 화면과 lib/profitReportExcel.js 엑셀 생성이
 * 각자 중복 계산하던 걸 공용화(2026-08-11 결함수정 5) — 계산식 자체는 바꾸지 않았다.
 * @param {{C:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{C:number}} totals   computeProfitTotals() 결과 */
export function calcRevenueRatio(rowCalc, totals) {
  const totalC = n0(totals?.C);
  return totalC !== 0 ? n0(rowCalc?.C) / totalC : null;
}

/** 상품구매비율(U) — row.P / totals.P. 분모(totals.P)는 공제/국내 행을 제외하지 않지만,
 * 화면 합계 U의 분자는 공제/국내와 베트남을 제외한다. D와 합계 범위가 다른 원본 엑셀 규칙이다.
 * 합계가 0이면 빈칸(null).
 * @param {{P:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{P:number}} totals   computeProfitTotals() 결과 */
export function calcPurchaseRatio(rowCalc, totals) {
  const totalP = n0(totals?.P);
  return totalP !== 0 ? n0(rowCalc?.P) / totalP : null;
}

/** 본표 합계에서 제외하는 행 — 원본 엑셀 본표(7~22행)에는 이 행 자체가 없다.
 * 화면·엑셀 모두 별도 검증 영역과 비고에만 표시하고, C/D/E/F/I/J/K 어느 합계에도 넣지 않는다.
 * 자동으로 정식 카테고리에 합산하지도 않는다 — 품목 분류를 고쳐야 사라지는 audit 대상이다. */
export const TOTALS_EXCLUDED_CATEGORIES = ['기타(미분류)'];

// 원본 엑셀 합계행 U24는 SUM(U7:U20)이다. 따라서 공제(22행)는 물론
// 베트남(21행)도 합계 표시에서 제외하지만, 분모 P24에는 베트남 구매액이 포함된다.
// 이 비대칭 범위까지 원본 수식을 그대로 재현한다.
export const WORKBOOK_TAIL_CATEGORIES = ['공제', '국내'];
export const PURCHASE_RATIO_TOTAL_EXCLUDED_CATEGORIES = [...WORKBOOK_TAIL_CATEGORIES, '베트남', ...TOTALS_EXCLUDED_CATEGORIES];

/**
 * 합계행 — 원본 엑셀 23행(본표 합계) 범위 규칙 그대로.
 *   · C / D / E / F / J : 마지막 본표 행(22~27차 공제, 28차부터 국내) **포함**
 *   · G/H/I/L/N/O/P/Q/S/T : 마지막 본표 행 **제외**
 *   · K 합계는 행 공식과 달리 항상 J/(C+F), M 합계는 -L/C
 * 기타(미분류)는 원본 본표에 없는 웹 전용 audit 행이라 모든 합계에서 제외한다(2026-08-12).
 */
export function computeProfitTotals(rowsWithCalc) {
  const rows = (rowsWithCalc || []).filter(r => !TOTALS_EXCLUDED_CATEGORIES.includes(r.category));
  const componentRows = rows.filter(r => !WORKBOOK_TAIL_CATEGORIES.includes(r.category));
  const purchaseRatioRows = rows.filter(r => !PURCHASE_RATIO_TOTAL_EXCLUDED_CATEGORIES.includes(r.category));
  const sum = (sel, list = rows) => list.reduce((s, r) => s + n0(sel(r.calc)), 0);
  const totals = {
    C: sum(c => c.C), E: sum(c => c.E), F: sum(c => c.F), J: sum(c => c.J),
    G: sum(c => c.G, componentRows), H: sum(c => c.H, componentRows), I: sum(c => c.I, componentRows),
    L: sum(c => c.L, componentRows), N: sum(c => c.N, componentRows), O: sum(c => c.O, componentRows),
    P: sum(c => c.P, componentRows), Q: sum(c => c.Q, componentRows), S: sum(c => c.S, componentRows),
    T: sum(c => c.T, componentRows),
    // 조정 합계는 표시 전용 — C/J 합계에는 각 행 계산값을 통해 이미 반영돼 있다.
    AC: sum(c => c.AC), AJ: sum(c => c.AJ),
  };
  totals.K = totals.C + totals.F !== 0 ? totals.J / (totals.C + totals.F) : null;
  totals.M = totals.C !== 0 ? -(totals.L / totals.C) : null;
  totals.D = totals.C !== 0 ? 1 : null;
  totals.U = totals.P !== 0 ? sum(c => c.P, purchaseRatioRows) / totals.P : null;
  return totals;
}
