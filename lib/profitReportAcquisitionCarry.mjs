// Older evidenced inventory: a dated purchase is not absent merely because the FIFO window ended.
// This policy never supplies a sales price, current exchange rate, or a different product's cost.
import { isApprovedCustomsTimingPeriod } from './profitReportCustomsRateTiming.mjs';

export function purchaseRateCountry(category) {
  return String(category || '').startsWith('콜롬비아 ') ? '콜롬비아' : category;
}

export function needsPurchasePeriodFreight(orderYear, major, category) {
  return category === '태국' || (isApprovedCustomsTimingPeriod(orderYear, major)
    && ['중국', '네덜란드', '에콰도르', '호주', '베트남', '콜롬비아 수국', '콜롬비아 카네이션',
      '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로'].includes(category));
}
export function inventoryWeekRank(week) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(week || ''));
  return m && +m[1] >= 1 && +m[1] <= 99 && +m[2] >= 1 && +m[2] <= 99
    ? +m[1] * 100 + +m[2] : null;
}

export function isEstimatedPurchaseRate(source) {
  return String(source || '').includes('approved_customs_timing_estimate');
}

export function withPurchaseRateEvidence(evidence, { rateSource, rateDetail, orderYear, major } = {}) {
  if (!evidence || !isEstimatedPurchaseRate(rateSource) || evidence.reportRateApplied === false) return evidence;
  if (String(rateDetail?.orderYear) !== String(orderYear) || Number(rateDetail?.major) !== Number(major)) return null;
  return { ...evidence, source: 'APPROVED_ESTIMATE', estimated: true,
    rateDetail: rateDetail || null,
    sourceRefs: [...(evidence.sourceRefs || []),
      `approved_customs_timing_estimate:${orderYear}:${major}:${rateDetail?.scheduleId || 'approved-week-pattern'}:${rateDetail?.dateSource || 'customs-week-pattern'}`] };
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

export function buildAcquisitionCarryEvidence(row, { orderYear, targetWeek, rate, rateSource, rateDetail, arrival }) {
  const snapshotOnlyRate = arrival?.reportRateApplied === false
    && arrival?.reportRateEvidence?.length > 0
    && arrival.reportRateEvidence.every(item => item.source === 'freight_cost_snapshot' && Number.isFinite(Number(item.rate)) && Number(item.rate) > 0);
  if (!selectOlderAcquisitionPurchases([row], { orderYear, targetWeek }).length
    || (!snapshotOnlyRate && (!Number.isFinite(Number(rate)) || !(Number(rate) > 0) || !rateSource || /approximate|currency_master|missing/i.test(rateSource)))
    || !(Number(arrival?.price) > 0) || arrival.goodsCostMissing
    || arrival.unit !== row.EstUnit || Number(arrival.rowCount) !== Number(row.RowCount)) return null;
  return withPurchaseRateEvidence({
    price: Number(arrival.price), unit: row.EstUnit, source: arrival.estimated ? 'APPROVED_ESTIMATE' : 'VERIFIED_CARRIED_ACQUISITION',
    estimated: arrival.estimated === true,
    ...(arrival.reportRateApplied != null ? { reportRateApplied: arrival.reportRateApplied, reportRateEvidence: arrival.reportRateEvidence || [] } : {}),
    estimateDetails: arrival.estimateDetails || [],
    sourceRefs: [
      `erp-purchase-carry:${orderYear}:${row.OrderWeek}->${targetWeek}:prod-${row.ProdKey}:${row.EstUnit}:purchase-foreign-${Number(row.ForeignTotal) / Number(row.Quantity)}:fx-${snapshotOnlyRate ? (arrival.reportRateEvidence || []).map(item => `${item.rate}(${item.source})`).join(',') : `${rate}(${rateSource})`}:arrival-reconstruction`,
      ...(arrival.sourceRefs || []),
    ],
  }, { rateSource, rateDetail, orderYear, major: String(row.OrderWeek).split('-')[0] });
}

// Scoped opt-in for the report only. A mismatch must not fall back to CurrencyMaster.
export function resolveAcquisitionCarryFx(evidence, { currency, country }) {
  if (!evidence) return undefined;
  return evidence.currency === currency && evidence.country === country && Number(evidence.rate) > 0
    ? { rate: Number(evidence.rate), source: 'report_purchase_period_taxable' } : null;
}

// Shared by Thai FIFO and the older-purchase path: never call the generic
// freight loader without an exact historical FX opt-in (it may use today's FX).
export async function loadPurchasePeriodArrivalEvidence({ orderYear, orderWeek, country, currency, rate, rateSource, rateDetail, reportCustomsCost }, loadArrival) {
  if (!/^\d{4}$/.test(String(orderYear)) || inventoryWeekRank(orderWeek) == null
    || !country || !currency) return {};
  const normalizedWeek = String(orderWeek).split('-').map(part => part.padStart(2, '0')).join('-');
  const preserveStoredExchangeRate = country !== '태국' && rateSource !== 'manual'
    && isApprovedCustomsTimingPeriod(orderYear, normalizedWeek.split('-')[0]);
  const validPolicyRate = Number.isFinite(Number(rate)) && Number(rate) > 0 && rateSource && !/approximate|currency_master|missing/i.test(rateSource);
  if (!validPolicyRate && !preserveStoredExchangeRate) return {};
  if (isEstimatedPurchaseRate(rateSource) && (String(rateDetail?.orderYear) !== String(orderYear)
    || Number(rateDetail?.major) !== Number(normalizedWeek.split('-')[0]))) return {};
  return loadArrival(String(orderYear), normalizedWeek, {
    reportExchangeRate: { currency, country: purchaseRateCountry(country), rate: validPolicyRate ? Number(rate) : null,
      ...(preserveStoredExchangeRate ? { preserveStoredExchangeRate: true } : {}),
      ...(validPolicyRate && isEstimatedPurchaseRate(rateSource) ? { source: rateSource, estimated: true, detail: rateDetail || null } : {}) },
    ...(country === '태국' && reportCustomsCost ? { reportCustomsCost } : {}),
  });
}
