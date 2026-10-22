import { isSupportedInventoryValuation } from './profitReportExcelRulebook.mjs';

// Closing inventory and next period opening inventory use the identical selector.
// Each caller supplies the year/week of the inventory being valued, not today's.
export function selectReportInventoryValuation({ year, major, week, average, direct,
  directStatus, directSources = [] } = {}) {
  if (!/^\d{4}$/.test(String(year)) || !/^\d{2}$/.test(String(major))) return null;
  const ref = `erp:${year}:${week || `${major}-last`}`;
  if (average) return { value: average.value, status: 'VERIFIED_CATEGORY_AVERAGE',
    sources: [`${ref}:category-average:(G+H)/purchaseQty*ProductStock`] };
  if (direct != null && Number.isFinite(Number(direct))
    && isSupportedInventoryValuation(directStatus, directSources)) {
    return { value: Number(direct), status: directStatus || 'VERIFIED', sources: directSources };
  }
  // Workbook F literals refer to the workbook's stock, not today's SQL stock.
  // An all-country average or aggregate previous-price extrapolation is not a
  // common formula demonstrated by weeks 26–31. Never silently apply these.
  return null;
}
