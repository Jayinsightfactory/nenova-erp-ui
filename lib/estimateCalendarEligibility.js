// FormEstimateView's calendar is an eligibility join, not optional display metadata.
// Keep SQL datetime equality: CONVERT(date, ...) would incorrectly admit off-time rows.
export function estimateCalendarMatchSql(estimate = 'e', calendar = 'pd') {
  return `${estimate}.EstimateDtm = ${calendar}.BaseYmd`;
}

export function estimateCalendarJoinSql(estimate = 'e', calendar = 'pd') {
  return `JOIN PeriodDay ${calendar} ON ${estimateCalendarMatchSql(estimate, calendar)}`;
}

export function estimateCalendarExistsSql(estimate = 'e', calendar = 'estimateDay') {
  return `EXISTS (SELECT 1 FROM PeriodDay ${calendar} WHERE ${estimateCalendarMatchSql(estimate, calendar)})`;
}

export function selectedEstimateWeekDay(weekDay, codes) {
  return weekDay != null && Number.isInteger(Number(weekDay)) && codes.has(Number(weekDay));
}
