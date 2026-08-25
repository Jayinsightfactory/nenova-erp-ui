import { resolveOrderWeekQuery } from './orderUtils.js';

function parentWeekToken(week) {
  const token = String(week || '').split('-')[0];
  const n = Number(token);
  return Number.isInteger(n) && n > 0 ? String(n) : '';
}

export function resolveEstimateLinkWeek(selectedWeek, explicitYear) {
  const rawWeek = String(selectedWeek || '').trim();
  const yearHint = String(explicitYear || '').replace(/\D/g, '').slice(0, 4);
  if (/^\d{1,2}$/.test(rawWeek) && yearHint) {
    return resolveOrderWeekQuery(`${yearHint}-${rawWeek.padStart(2, '0')}-01`, yearHint);
  }
  const resolved = resolveOrderWeekQuery(rawWeek, yearHint || undefined);
  if (yearHint) return { ...resolved, year: yearHint };
  return resolved;
}

export function buildEstimateFixStatusUrl(selectedWeek, explicitYear) {
  const { week, year } = resolveEstimateLinkWeek(selectedWeek, explicitYear);
  const parentWeek = parentWeekToken(week);
  if (!parentWeek || !year) return '';
  const query = new URLSearchParams({
    popup: '1',
    year: String(year),
    week: parentWeek,
    openFixStatus: '1',
  });
  return `/estimate?${query.toString()}`;
}

export function buildEstimateCustomerUrl({ year, week, custKey, customerName } = {}) {
  const ck = Number(custKey);
  if (!Number.isInteger(ck) || ck <= 0) return '';
  const resolved = resolveEstimateLinkWeek(week, year);
  const parentWeek = parentWeekToken(resolved.week);
  if (!resolved.year || !parentWeek) return '';
  const query = new URLSearchParams({
    popup: '1',
    year: String(resolved.year),
    week: parentWeek,
    custKey: String(ck),
    includeUnfixed: '1',
    highlightDeductions: '1',
  });
  const name = String(customerName || '').trim();
  if (name) query.set('custName', name);
  return `/estimate?${query.toString()}`;
}
