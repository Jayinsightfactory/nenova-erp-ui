export function defectSourcePeriod(year, week) {
  const parent = String(week ?? '').trim().match(/^(\d{1,2})(?:-\d+)?$/);
  if (!Number(year) || !parent || Number(parent[1]) < 1 || Number(parent[1]) > 53) return '';
  return `${Number(year)}/${Number(parent[1])}`;
}

export function defectCarryoverApproval(year, week, customerKey) {
  const period = defectSourcePeriod(year, week);
  return period && Number(customerKey) > 0 ? `${period}/${Number(customerKey)}` : '';
}

export function defectCarryoverAllowed(row, targetYear, targetWeek, approval) {
  const source = defectSourcePeriod(row.OrderYear, row.OrderWeek);
  const target = defectSourcePeriod(targetYear, targetWeek);
  const expected = defectCarryoverApproval(row.OrderYear, row.OrderWeek, row.CustKey);
  return Boolean(source && target && (approval == null
    ? source === target
    : source !== target && expected && expected === approval));
}
