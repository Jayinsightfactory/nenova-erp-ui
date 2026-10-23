import { isSupportedInventoryValuation } from './profitReportExcelRulebook.mjs';

// Closing inventory and next period opening inventory use the identical selector.
// Each caller supplies the year/week of the inventory being valued, not today's.
export function selectReportInventoryValuation({ year, major, week, average, direct,
  directStatus, directSources = [] } = {}) {
  if (!/^\d{4}$/.test(String(year)) || !/^\d{2}$/.test(String(major))) return null;
  const ref = `erp:${year}:${week || `${major}-last`}`;
  if (average) return { value: average.value, status: average.estimated ? 'APPROVED_ESTIMATE' : 'VERIFIED_CATEGORY_AVERAGE',
    sources: [`${ref}:category-average:(G+H)/purchaseQty*ProductStock`, ...(average.sourceRefs || [])] };
  if (direct != null && Number.isFinite(Number(direct))
    && isSupportedInventoryValuation(directStatus, directSources)) {
    return { value: Number(direct), status: directStatus || 'VERIFIED', sources: directSources };
  }
  // Workbook F literals refer to the workbook's stock, not today's SQL stock.
  // Only proven workbook categories or explicitly approved, unit-normalized
  // country averages are supplied by the caller. No blanket country fallback.
  return null;
}
