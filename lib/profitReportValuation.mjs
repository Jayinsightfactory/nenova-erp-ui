// Closing inventory and next period opening inventory use the identical selector.
// Each caller supplies the year/week of the inventory being valued, not today's.
export function selectReportInventoryValuation({ year, major, week, average, direct,
  directStatus, directSources = [], historical, averageFallback, carried } = {}) {
  if (!/^\d{4}$/.test(String(year)) || !/^\d{2}$/.test(String(major))) return null;
  const ref = `erp:${year}:${week || `${major}-last`}`;
  if (average) return { value: average.value, status: 'VERIFIED_CATEGORY_AVERAGE',
    sources: [`${ref}:category-average:(G+H)/purchaseQty*ProductStock`] };
  if (direct != null) return { value: direct, status: directStatus || 'VERIFIED', sources: directSources };
  if (historical) return { value: Number(historical.value), status: historical.status, sources: [historical.sourceRef] };
  if (averageFallback) return { value: averageFallback.value, status: 'VERIFIED_CATEGORY_AVERAGE_FALLBACK',
    sources: [`${ref}:category-average-fallback:(G+H)/purchaseQty*ProductStock`] };
  if (carried) return { value: carried.value, status: 'VERIFIED_CARRIED_UNIT_COST',
    sources: [`erp:${carried.sourceWeek}:carried-unit-cost->${year}:${major}`] };
  return null;
}
