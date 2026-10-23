/** Pure diagnostics for period-scoped SQL rows; loader owns year/week filtering.
 * Global available means the SELECT succeeded, not that every category is covered.
 * Each byCategory status separately reports complete/partial/absent/rejected. */
export function buildInvoiceRateEvidence(rows = [], { orderYear, major, queryFailed = false } = {}) {
  const evidence = { orderYear: String(orderYear), major: Number(major),
    source: 'FreightCost.ExchangeRate', status: queryFailed ? 'query_failed' : 'available', byCategory: {} };
  const rates = {};
  if (queryFailed) return { rates, evidence };
  for (const row of rows) {
    const total = Number(row.TotalWeight || 0);
    const covered = Number(row.CoveredWeight || 0);
    const rate = Number(row.rate);
    const tolerance = Math.max(0.000001, Math.abs(total) * 1e-9);
    const complete = total > 0 && Math.abs(total - covered) <= tolerance;
    const valid = Number.isFinite(rate) && rate > 0;
    const malformed = !Number.isFinite(total) || !Number.isFinite(covered)
      || total < 0 || covered < 0 || covered > total + tolerance || (covered > 0 && !valid);
    const status = malformed ? 'rejected' : complete && valid ? 'available' : covered > 0 ? 'partial' : 'absent';
    evidence.byCategory[row.Category] = { status, totalPurchaseForeign: total,
      coveredPurchaseForeign: covered, uncoveredPurchaseForeign: Math.max(0, total - covered),
      coveredRate: valid && covered > 0 ? rate : null, applied: status === 'available' };
    if (status === 'available') rates[row.Category] = rate;
  }
  return { rates, evidence };
}
