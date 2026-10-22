// Calculation evidence, not copied inventory amounts or a promise of identical margins.
export const PROFIT_EXCEL_BASELINE = Object.freeze({
  id: 'excel-2026-26-31-v1',
  primaryWeeks: [26, 27, 28, 29, 30, 31],
  secondaryWeeks: [1, 25],
  normal: { I: 'E+G+H-F', J: 'C-I+AJ', K: 'J/C' },
  noEnding: { I: 'E+G+H', J: 'C-I+F+AJ', K: 'J/(C+F)' },
  totalRate: 'J/(C+F)',
});

// These legacy evidence rows explicitly say that their basis is a selling price.
// A VERIFIED database flag cannot turn that into acquisition-cost evidence.
// Reject only an explicit basis, not a note such as "판매단가 아님".
export function isAcquisitionCostSource(sourceRef) {
  const source = String(sourceRef || '').trim();
  return Boolean(source) && !/판매단가\s*기준\s*(?:자동)?\s*재고평가|auto-stock-price:|AUTO_SALES_PRICE|approximate_currency_master/i.test(source);
}

export function acquisitionEvidencePrice(price, sourceRef) {
  return price != null && Number.isFinite(Number(price)) && Number(price) >= 0
    && isAcquisitionCostSource(sourceRef) ? Number(price) : null;
}

export const UNPROVEN_INVENTORY_STATUSES = Object.freeze([
  'VERIFIED_SALES_PRICE_AUTO', 'VERIFIED_CATEGORY_AVERAGE_FALLBACK',
  'VERIFIED_CARRIED_UNIT_COST', 'VERIFIED_HISTORICAL_WORKBOOK',
]);

export function isSupportedInventoryValuation(status, sources = []) {
  return !UNPROVEN_INVENTORY_STATUSES.includes(status)
    && sources.every(isAcquisitionCostSource);
}

// Australia is CNF: the goods invoice includes freight. The workbook inventory
// uses a product's foreign purchase price × AUD FX (with separately allocated H).
// A missing FreightCost calculation must not hide a complete SQL goods invoice.
// Do not generalize to FOB countries, another product, partial quantities or FX.
export function buildAustraliaPurchaseEvidence(row, { orderYear, targetWeek, rate, rateSource, hShare, purchaseUnit } = {}) {
  const rank = (week) => { const m=/^(\d{1,2})-(\d{1,2})$/.exec(String(week||'')); return m && +m[1]>0 && +m[1]<=53 && +m[2]>0 && +m[2]<=99 ? +m[1]*100 + +m[2] : null; };
  const purchased=rank(row?.OrderWeek), target=rank(targetWeek);
  const qty=Number(row?.Quantity), foreign=Number(row?.ForeignTotal), fx=Number(rate), customs=Number(hShare);
  if (!/^\d{4}$/.test(String(orderYear)) || String(row?.OrderYear)!==String(orderYear)
    || row?.Category!=='호주' || row?.Complete!==true || !(Number(row?.ProdKey)>0)
    || !['단','송이','박스'].includes(row?.EstUnit) || purchased==null || target==null || purchased>target
    || ![qty,foreign,fx,customs].every(Number.isFinite) || qty<=0 || foreign<=0 || fx<=0 || customs<0 || hShare==null
    || (customs>0 && purchaseUnit!==row.EstUnit)
    || !rateSource || /approximate|currency_master|missing/i.test(rateSource)) return null;
  return { price: foreign/qty*fx+customs, unit: row.EstUnit, source:'VERIFIED_PURCHASE_FX_ARRIVAL',
    sourceRefs:[`erp-cnf-purchase:${orderYear}:${row.OrderWeek}->${targetWeek}:prod-${row.ProdKey}:${row.EstUnit}:foreign-${foreign}/qty-${qty}:fx-${fx}(${rateSource}):customs-per-unit-${customs}`] };
}
