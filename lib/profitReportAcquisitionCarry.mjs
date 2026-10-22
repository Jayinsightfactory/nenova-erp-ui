// Older evidenced inventory: a dated purchase is not absent merely because the FIFO window ended.
// This policy never supplies a sales price, current exchange rate, or a different product's cost.
export function inventoryWeekRank(week) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(week || ''));
  return m && +m[1] >= 1 && +m[1] <= 99 && +m[2] >= 1 && +m[2] <= 99
    ? +m[1] * 100 + +m[2] : null;
}

export function selectOlderAcquisitionPurchases(rows, { orderYear, targetWeek, existing = {} }) {
  const target = inventoryWeekRank(targetWeek);
  if (!/^\d{4}$/.test(String(orderYear)) || target == null) return [];
  const latest = new Map();
  for (const row of rows || []) {
    const rank = inventoryWeekRank(row.OrderWeek);
    if (String(row.OrderYear) !== String(orderYear) || rank == null || rank > target
      || !['에콰도르', '네덜란드', '호주', '중국', '태국'].includes(row.Category)
      || !(Number(row.ProdKey) > 0) || existing[String(row.ProdKey)]) continue;
    const key = String(row.ProdKey);
    if (!latest.has(key) || latest.get(key).rank < rank) latest.set(key, { ...row, rank });
  }
  return [...latest.values()].filter(row => Math.floor(target / 100) - Math.floor(row.rank / 100) > 3
    && Number(row.Quantity) > 0 && Number(row.ForeignTotal) > 0 && row.Complete === true);
}

export function buildAcquisitionCarryEvidence(row, { orderYear, targetWeek, rate, rateSource, arrival }) {
  if (!selectOlderAcquisitionPurchases([row], { orderYear, targetWeek }).length
    || !(Number(rate) > 0) || !rateSource || /approximate|currency_master|missing/i.test(rateSource)
    || !(Number(arrival?.price) > 0) || arrival.goodsCostMissing
    || arrival.unit !== row.EstUnit || Number(arrival.rowCount) !== Number(row.RowCount)) return null;
  return {
    price: Number(arrival.price), unit: row.EstUnit, source: 'VERIFIED_CARRIED_ACQUISITION',
    sourceRefs: [
      `erp-purchase-carry:${orderYear}:${row.OrderWeek}->${targetWeek}:prod-${row.ProdKey}:${row.EstUnit}:purchase-foreign-${Number(row.ForeignTotal) / Number(row.Quantity)}:fx-${rate}(${rateSource}):arrival-reconstruction`,
    ],
  };
}

// Scoped opt-in for the report only. A mismatch must not fall back to CurrencyMaster.
export function resolveAcquisitionCarryFx(evidence, { currency, country }) {
  if (!evidence) return undefined;
  return evidence.currency === currency && evidence.country === country && Number(evidence.rate) > 0
    ? { rate: Number(evidence.rate), source: 'report_purchase_period_taxable' } : null;
}

// Shared by Thai FIFO and the older-purchase path: never call the generic
// freight loader without an exact historical FX opt-in (it may use today's FX).
export async function loadPurchasePeriodArrivalEvidence({ orderYear, orderWeek, country, currency, rate, rateSource }, loadArrival) {
  if (!/^\d{4}$/.test(String(orderYear)) || inventoryWeekRank(orderWeek) == null
    || !country || !currency || !Number.isFinite(Number(rate)) || !(Number(rate) > 0)
    || !rateSource || /approximate|currency_master|missing/i.test(rateSource)) return {};
  const normalizedWeek = String(orderWeek).split('-').map(part => part.padStart(2, '0')).join('-');
  return loadArrival(String(orderYear), normalizedWeek, {
    reportExchangeRate: { currency, country, rate: Number(rate) },
  });
}
