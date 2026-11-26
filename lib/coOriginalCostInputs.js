// Verified 42-1 workbook P6:P10, R6:R7. Reference assumptions, not paid bills.
export const CO_ORIGINAL_CUSTOMS_SOURCE = '콜롬비아 42-1 원본: GW×460 + 통관33,000 + 품종수×10,000 + 국내운송99,000 + 검역40,000';
export const CO_ORIGINAL_CUSTOMS_DEFAULTS = Object.freeze({storagePerKg:460, clearance:33000, inspectionPerGroup:10000, domestic:99000, quarantine:40000});
const numeric = value => value == null || typeof value === 'boolean' || typeof value === 'object'
  || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function resolveCoCustomsComponents(overrides) {
  const raw = overrides && typeof overrides === 'object' ? overrides : {};
  const pick = (key, fallback) => {
    const v = numeric(raw[key]);
    return v !== null && v >= 0 ? v : fallback;
  };
  const d = CO_ORIGINAL_CUSTOMS_DEFAULTS;
  const next = {
    storagePerKg: pick('storagePerKg', d.storagePerKg),
    clearance: pick('clearance', d.clearance),
    inspectionPerGroup: pick('inspectionPerGroup', d.inspectionPerGroup),
    domestic: pick('domestic', d.domestic),
    quarantine: pick('quarantine', d.quarantine),
    disinfection: pick('disinfection', 0),
  };
  const customized = next.storagePerKg !== d.storagePerKg
    || next.clearance !== d.clearance
    || next.inspectionPerGroup !== d.inspectionPerGroup
    || next.domestic !== d.domestic
    || next.quarantine !== d.quarantine
    || next.disinfection !== 0;
  return { ...next, customized };
}
export function calculateCoOriginalCustoms(gw, groupIds, overrides) {
  const weight=numeric(gw), count=new Set(groupIds || []).size;
  const c=resolveCoCustomsComponents(overrides);
  const source=c.customized
    ? `콜롬비아 42-1 수식(사용자 보정): GW×${c.storagePerKg} + 통관${c.clearance.toLocaleString('ko-KR')} + 품종수×${c.inspectionPerGroup.toLocaleString('ko-KR')} + 국내운송${c.domestic.toLocaleString('ko-KR')} + 검역${c.quarantine.toLocaleString('ko-KR')}${c.disinfection ? ` + 소독${c.disinfection.toLocaleString('ko-KR')}` : ''}`
    : CO_ORIGINAL_CUSTOMS_SOURCE;
  if (!(weight>0) || !count) return {total:null,groupCount:count,source,components:c};
  return {total:Math.round((weight*c.storagePerKg+c.clearance+count*c.inspectionPerGroup+c.domestic+c.quarantine+c.disinfection)*1e6)/1e6,
    groupCount:count,source,components:c};
}
export function coCustomsInput(input, gw, groupIds) {
  // Legacy explicit totals (including zero) stay authoritative unless FORMULA is selected.
  const explicitTotalMode = input?.customsMode === 'TOTAL';
  const mode=input.customsMode ?? (numeric(input.customsTotalKRW)===null?'FORMULA':'TOTAL');
  if (!['FORMULA','TOTAL'].includes(mode)) throw new Error('콜롬비아 통관비 계산 방식을 확인하세요.');
  if (mode==='TOTAL') return {...input,customsMode:mode,...(explicitTotalMode?{customsExplicitTotal:true}:{})};
  const calculation=calculateCoOriginalCustoms(gw,groupIds,input.coCustomsOverrides);
  const cleanOverrides = calculation.components.customized
    ? {
      storagePerKg: calculation.components.storagePerKg,
      clearance: calculation.components.clearance,
      inspectionPerGroup: calculation.components.inspectionPerGroup,
      domestic: calculation.components.domestic,
      quarantine: calculation.components.quarantine,
      disinfection: calculation.components.disinfection,
    }
    : undefined;
  return {...input,customsMode:mode,customsTotalKRW:calculation.total,expenseBasis:'ESTIMATED',estimateSource:calculation.source,
    ...(cleanOverrides?{coCustomsOverrides:cleanOverrides}:{})};
}

// EXE preserves TPrice independently. An aggregate FOB rounded to four
// decimals may differ by cents; accept only that exact rounding relationship.
// Real quantity/price/amount disagreements still reach the existing blocker.
export function coReceiptCostPrice(row) {
  const quantity=numeric(row.stemQuantity),amount=numeric(row.lineAmount),price=numeric(row.unitPrice);
  if (!(quantity>0) || !(amount>=0) || !(price>=0)) return {...row};
  const weighted=amount/quantity;
  if(Math.abs(price*quantity-amount)>1e-6 && Math.abs(price*10000-Math.round(price*10000))<1e-7
    && Math.abs(Math.round(weighted*10000)/10000-price)<1e-10)
    return {...row,receiptUnitPrice:price,unitPrice:weighted,costPriceBasis:'RECEIPT_TOTAL_WEIGHTED'};
  return {...row};
}
