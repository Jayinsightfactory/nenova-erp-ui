// Official rate values, but user-approved estimated customs timing. No DB or clock access.
export const APPROVED_CUSTOMS_TIMING_SOURCE = 'approved_customs_timing_estimate';
export const CUSTOMS_TIMING_POLICY_VERSION = '2026-10-23';

const RULES = Object.freeze({
  '콜롬비아 수국': ['USD', 0],
  '콜롬비아 카네이션': ['USD', 0],
  '콜롬비아 장미': ['USD', 0],
  '콜롬비아 루스커스': ['USD', 0],
  '콜롬비아 알스트로': ['USD', 0],
  베트남: ['USD', 0], 호주: ['AUD', 0],
  네덜란드: ['EUR', 1], 태국: ['USD', 1], 에콰도르: ['USD', 1], 중국: ['CNY', 1],
});

/** Valid ISO year/week, including real 53-week years only. */
export function isoWeekMondayDate(orderYear, isoWeek) {
  const year = Number(orderYear), week = Number(isoWeek);
  if (!Number.isInteger(year) || year < 2000 || year > 9998
    || !Number.isInteger(week) || week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(Date.UTC(year, 0, 5 - (jan4.getUTCDay() || 7) + (week - 1) * 7));
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  return thursday.getUTCFullYear() === year ? monday.toISOString().slice(0, 10) : null;
}

export function isApprovedCustomsTimingPeriod(orderYear, major) {
  if (!isoWeekMondayDate(orderYear, major)) return false;
  return Number(orderYear) > 2026 || (Number(orderYear) === 2026 && Number(major) >= 28);
}

export function approvedCustomsTiming({ orderYear, major, category, currency } = {}) {
  if (!isApprovedCustomsTimingPeriod(orderYear, major)) return null;
  const rule = RULES[category];
  if (!rule || String(currency || '').toUpperCase() !== rule[0]) return null;
  // Original29China uses major-week. Do not generalize its historical exception to future years.
  const offset = category === '중국' && Number(orderYear) === 2026 && Number(major) === 29 ? 0 : rule[1];
  const base = isoWeekMondayDate(orderYear, major);
  const date = new Date(Date.parse(`${base}T00:00:00Z`) + offset * 7 * 86400000).toISOString().slice(0, 10);
  return {
    date, source: APPROVED_CUSTOMS_TIMING_SOURCE, estimated: true,
    orderYear: String(Number(orderYear)), major: String(Number(major)).padStart(2, '0'),
    category, currency: rule[0], isoWeekOffset: offset,
    scheduleId: `APPROVED_CUSTOMS_TIMING_${CUSTOMS_TIMING_POLICY_VERSION}_${offset ? 'NEXT' : 'MAJOR'}_ISO_WEEK`,
    policyVersion: CUSTOMS_TIMING_POLICY_VERSION,
    evidenceWeeks: ['2026-26', '2026-27', '2026-28', '2026-29', '2026-30', '2026-31'],
  };
}
