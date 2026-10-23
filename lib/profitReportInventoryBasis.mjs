// Read-only presentation of the valuation actually selected by the report API.
// This helper never selects a new price or changes E/F.
const finite = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const DIRECT_LABELS = {
  VERIFIED_FIFO_PURCHASE: '품목별 매입 차수 원가(FIFO)',
  VERIFIED_ARRIVAL_COST: '품목별 확정 도착원가',
  VERIFIED_FREIGHT_ARRIVAL_CALC: '품목별 운송·통관 포함 원가',
  VERIFIED_CARRIED_ACQUISITION: '품목별 과거 매입원가 이월',
  VERIFIED_WORKBOOK_CATALOG: '품목별 엑셀 매입원가 근거',
  VERIFIED_SAMPLE_AVERAGE: '샘플 품목의 검증 원가 평균',
  VERIFIED_MIXED: '품목별 원가 근거 합산',
};
export const INVENTORY_BASIS_REASONS = Object.freeze({
  not_proven_category: '이 국가·품종은 일괄 평균식이 확인되지 않아 품목별 원가를 사용합니다.',
  no_purchase: '해당 평가 차수에 매입수량이 없어 당차수 평균을 계산하지 않고 품목별 매입 근거를 사용합니다.',
  unit_mismatch: '매입·재고의 단위가 혼합되어 국가 합계 수량을 나눈 평균을 적용하지 않습니다.',
  conversion_missing: '일부 품목의 재고 단위 환산 근거가 없습니다.',
  average_unavailable: '평균 계산에 필요한 매입수량·환율 등 근거가 부족해 기존 품목별 원가를 확인합니다.',
  missing_snapshot: '해당 평가 차수의 재고 스냅샷이 없습니다.',
  missing_value: '재고 평가 근거가 부족하여 금액 계산이 보류되었습니다.',
  confirmed_legacy: '확정 당시 평균단가·분모가 별도 보관되지 않았습니다. 현재 DB 값으로 역산하지 않습니다.',
  metadata_missing: '이 조회 결과에는 상세 평가 근거가 제공되지 않았습니다. 기존 금액을 임의로 역산하지 않습니다.',
});

export function buildInventoryBasis({ category, year, major, stock = {}, value, average,
  inputs = {}, averageEligible = false, units = [], confirmed = false } = {}) {
  const base = { category: String(category || ''), year: String(year || ''), major: String(major || ''),
    week: stock.week || null, value: finite(value), method: 'missing', label: '평가 근거 확인 필요',
    quantity: null, unit: null, average: null, estimated: false, reason: null,
    sources: Array.isArray(stock.priceEvidenceSources) ? [...stock.priceEvidenceSources] : [] };
  if (confirmed) return { ...base, year: null, major: null, week: null, sources: [], estimated: false,
    method: 'confirmed_snapshot', label: '저장된 확정 재고액', reason: 'confirmed_legacy' };
  if (!/^\d{4}$/.test(base.year) || !/^(0[1-9]|[1-4]\d|5[0-3])$/.test(base.major)) {
    return { ...base, reason: 'metadata_missing' };
  }
  base.quantity = finite(stock.endQty);
  const knownUnits = [...new Set(units.map((unit) => String(unit || '').trim()))];
  if (!stock.unitMismatch && !stock.conversionMissingCount && knownUnits.length === 1
    && ['박스', '단', '송이'].includes(knownUnits[0])) base.unit = knownUnits[0];
  base.estimated = stock.priceEvidenceStatus === 'APPROVED_ESTIMATE' || average?.estimated === true;
  if (stock.snapshotConfirmed !== true) return { ...base, reason: 'missing_snapshot' };
  if (stock.conversionMissingCount > 0) return { ...base, quantity: null, reason: 'conversion_missing' };
  if (base.value == null) return { ...base, reason: stock.conversionMissingCount ? 'conversion_missing' : 'missing_value' };
  if (base.quantity === 0 && !stock.unitMismatch) return { ...base, method: 'no_stock', label: '환산재고수량 0' };
  if (base.quantity === 0 && stock.unitMismatch) return { ...base, method: 'product_cost', label: DIRECT_LABELS[stock.priceEvidenceStatus] || '품목별 원가 근거 합산', reason: 'unit_mismatch' };
  if (average && finite(average.unitCost) != null && finite(average.value) === base.value) {
    const goods = finite(inputs.purchaseForeign), freight = finite(inputs.forwardingForeign);
    const rate = finite(inputs.taxableRate), customs = finite(inputs.customsCost);
    const totalCost = goods != null && freight != null && customs != null
      && ((goods === 0 && freight === 0) || rate != null) ? (goods + freight) * (rate ?? 0) + customs : null;
    return { ...base, method: 'category_average', label: '엑셀식 평균 도착원가',
      average: { unitCost: Number(average.unitCost), totalCost, purchaseQty: finite(inputs.purchaseQty),
        purchaseForeign: goods, forwardingForeign: freight, taxableRate: rate, customsCost: customs } };
  }
  const reason = stock.conversionMissingCount ? 'conversion_missing' : stock.unitMismatch ? 'unit_mismatch'
    : !averageEligible ? 'not_proven_category' : !(finite(inputs.purchaseQty) > 0) ? 'no_purchase' : 'average_unavailable';
  return { ...base, method: 'product_cost', label: DIRECT_LABELS[stock.priceEvidenceStatus] || '품목별 원가 근거 합산', reason };
}

export function inventoryBasisReason(basis) {
  return INVENTORY_BASIS_REASONS[basis?.reason] || '';
}
