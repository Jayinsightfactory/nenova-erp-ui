// Verified 42-1 workbook P6:P10, R6:R7. Reference assumptions, not paid bills.
export const CO_ORIGINAL_CUSTOMS_SOURCE = '콜롬비아 42-1 원본: GW×460 + 통관33,000 + 품종수×10,000 + 국내운송99,000 + 검역40,000';
export const CO_ORIGINAL_CUSTOMS_DEFAULTS = Object.freeze({storagePerKg:460, clearance:33000, inspectionPerGroup:10000, domestic:99000, quarantine:40000});
const numeric = value => value == null || typeof value === 'boolean' || typeof value === 'object'
  || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function calculateCoOriginalCustoms(gw, groupIds) {
  const weight=numeric(gw), count=new Set(groupIds || []).size;
  if (!(weight>0) || !count) return {total:null,groupCount:count,source:CO_ORIGINAL_CUSTOMS_SOURCE};
  const d=CO_ORIGINAL_CUSTOMS_DEFAULTS;
  return {total:Math.round((weight*d.storagePerKg+d.clearance+count*d.inspectionPerGroup+d.domestic+d.quarantine)*1e6)/1e6,
    groupCount:count,source:CO_ORIGINAL_CUSTOMS_SOURCE};
}
export function coCustomsInput(input, gw, groupIds) {
  // Legacy explicit totals (including zero) stay authoritative unless FORMULA is selected.
  const mode=input.customsMode ?? (numeric(input.customsTotalKRW)===null?'FORMULA':'TOTAL');
  if (!['FORMULA','TOTAL'].includes(mode)) throw new Error('콜롬비아 통관비 계산 방식을 확인하세요.');
  if (mode==='TOTAL') return {...input,customsMode:mode};
  const calculation=calculateCoOriginalCustoms(gw,groupIds);
  return {...input,customsMode:mode,customsTotalKRW:calculation.total,expenseBasis:'ESTIMATED',estimateSource:calculation.source};
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
