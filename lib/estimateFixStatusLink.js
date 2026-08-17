import { resolveOrderWeekQuery } from './orderUtils.js';

export function buildEstimateFixStatusUrl(selectedWeek) {
  const { week, year } = resolveOrderWeekQuery(selectedWeek);
  if (!week || !year) return '';
  const parentWeek = String(week).split('-')[0];
  const query = new URLSearchParams({
    popup: '1',
    year: String(year),
    week: parentWeek,
    openFixStatus: '1',
  });
  return `/estimate?${query.toString()}`;
}
