// lib/profitReportPriceMixCandidates.js — 매출이익 보고서: 거래처 단가하락/저가 거래처 구성비 변화 후보 탐지.
//
// 순수 함수만 있다(DB 호출 없음, 테스트 용이) — 호출부(pages/api/sales/profit-analysis.js)가
// lib/profitReportCustomerMixSql.js#loadCustomerProductSales() 로 이번 주차(currentRows)와
// 직전 주차(priorRows) 두 스냅샷을 이미 불러와 넘겨준다. row shape:
//   { custKey, prodKey, custName, qty, estQty, amount, vat, vatInclusiveUnitPrice, qtyShare, amountShare }
//
// 두 탐지기 모두 인과관계를 주장하지 않는다 — note는 항상 고정 문자열 '특가·재고소진 여부 확인'
// 하나뿐이며, "왜" 가격이 바뀌었는지 서술하는 문구를 절대 덧붙이지 않는다(담당자가 직접 확인해야 함).
const NOTE = '특가·재고소진 여부 확인';

const isFiniteNum = (v) => v != null && Number.isFinite(Number(v));
const rowKey = (r) => `${r.custKey ?? 'null'}|${r.prodKey}`;

/** 숫자 배열의 중앙값. null/NaN은 제외. 빈 배열이면 null. */
export function median(numbers) {
  const values = (numbers || [])
    .map((v) => (isFiniteNum(v) ? Number(v) : null))
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

/** {value,weight} 쌍의 가중평균. weight<=0 이거나 value가 숫자가 아닌 항목은 제외. 전체 weight가 0이면 null. */
export function weightedAverage(pairs) {
  let sumWV = 0;
  let sumW = 0;
  for (const p of pairs || []) {
    const value = isFiniteNum(p?.value) ? Number(p.value) : null;
    const weight = isFiniteNum(p?.weight) ? Number(p.weight) : 0;
    if (value == null || weight <= 0) continue;
    sumWV += value * weight;
    sumW += weight;
  }
  return sumW > 0 ? sumWV / sumW : null;
}

/**
 * 거래처×품목 단가하락 후보 — 현재/직전 두 스냅샷에 모두 존재하고 두 단가가 유효한 조합 중,
 * 현재 단가가 직전 대비 3% 이상 하락(currentPrice <= priorPrice * 0.97)한 건.
 * @param {Array} currentRows  이번 주차 loadCustomerProductSales() 결과
 * @param {Array} priorRows    직전 주차 loadCustomerProductSales() 결과
 */
export function detectPriceDecreaseCandidates(currentRows, priorRows) {
  const priorByKey = new Map((priorRows || []).map((r) => [rowKey(r), r]));
  const out = [];
  for (const cur of currentRows || []) {
    const prior = priorByKey.get(rowKey(cur));
    if (!prior) continue;
    const currentPrice = isFiniteNum(cur.vatInclusiveUnitPrice) ? Number(cur.vatInclusiveUnitPrice) : null;
    const priorPrice = isFiniteNum(prior.vatInclusiveUnitPrice) ? Number(prior.vatInclusiveUnitPrice) : null;
    if (currentPrice == null || priorPrice == null || priorPrice === 0) continue;
    if (currentPrice <= priorPrice * 0.97) {
      out.push({
        custKey: cur.custKey,
        prodKey: cur.prodKey,
        custName: cur.custName || prior.custName || '',
        productName: cur.productName || prior.productName || '',
        currentPrice,
        priorPrice,
        pctChange: Math.round(((currentPrice - priorPrice) / priorPrice) * 10000) / 10000, // 음수 비율, 예: -0.05
        kind: 'price_decrease',
        note: NOTE,
      });
    }
  }
  return out;
}

/**
 * 저가 거래처 구성비 확대 후보 — 품목별로 (수량 가중)가중평균 단가와 중앙값 단가를 구한 뒤,
 * 그 두 값보다 모두 5% 이상 낮은 단가로 사고 있으면서 그 거래처의 수량 비중(qtyShare)이 직전
 * 대비 2%p 이상 오른 조합. 직전에 그 거래처+품목 조합 자체가 없었으면(신규 대량 저가 구매자)
 * 직전 비중을 0으로 보고 그대로 판정한다.
 * @param {Array} currentRows                    이번 주차 loadCustomerProductSales() 결과
 * @param {Array} priorRowsForShareBaseline       직전 주차 loadCustomerProductSales() 결과(비중 비교 기준)
 */
export function detectLowPriceCustomerMixCandidates(currentRows, priorRowsForShareBaseline) {
  const priorByKey = new Map((priorRowsForShareBaseline || []).map((r) => [rowKey(r), r]));
  const byProd = new Map();
  for (const r of currentRows || []) {
    if (!byProd.has(r.prodKey)) byProd.set(r.prodKey, []);
    byProd.get(r.prodKey).push(r);
  }

  const out = [];
  for (const [, rows] of byProd) {
    const priceableRows = rows.filter((r) => isFiniteNum(r.vatInclusiveUnitPrice));
    const peerWeightedAvg = weightedAverage(priceableRows.map((r) => ({ value: r.vatInclusiveUnitPrice, weight: r.qty })));
    const peerMedian = median(priceableRows.map((r) => r.vatInclusiveUnitPrice));
    if (peerWeightedAvg == null || peerMedian == null) continue;
    const threshold = Math.min(peerWeightedAvg, peerMedian) * 0.95;

    for (const cur of rows) {
      const currentPrice = isFiniteNum(cur.vatInclusiveUnitPrice) ? Number(cur.vatInclusiveUnitPrice) : null;
      if (currentPrice == null || currentPrice > threshold) continue;

      const priorRow = priorByKey.get(rowKey(cur));
      const currentShare = isFiniteNum(cur.qtyShare) ? Number(cur.qtyShare) : 0;
      const priorShare = priorRow && isFiniteNum(priorRow.qtyShare) ? Number(priorRow.qtyShare) : 0;
      const shareDeltaPp = Math.round((currentShare - priorShare) * 100 * 100) / 100;
      if (shareDeltaPp < 2) continue;

      out.push({
        custKey: cur.custKey,
        prodKey: cur.prodKey,
        custName: cur.custName || '',
        productName: cur.productName || '',
        currentPrice,
        peerWeightedAvg,
        peerMedian,
        shareDeltaPp,
        kind: 'low_price_customer_mix',
        note: NOTE,
      });
    }
  }
  return out;
}
