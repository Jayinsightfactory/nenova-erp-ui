/** Build the ERP subweek key while tolerating legacy values such as `41-1`.
 * Available-week selectors normalize those values to `41-01`; data queries must
 * normalize the stored value the same way or valid rows disappear from scope.
 */
export function normalizedOrderYearWeekSql(alias) {
  const separator = `CHARINDEX('-', ${alias}.OrderWeek + '-')`;
  const major = `LEFT(${alias}.OrderWeek, ${separator} - 1)`;
  const sub = `SUBSTRING(${alias}.OrderWeek, ${separator} + 1, 10)`;
  return `CAST(${alias}.OrderYear AS NVARCHAR(4)) + RIGHT('0' + ${major}, 2) + RIGHT('0' + ${sub}, 2)`;
}
