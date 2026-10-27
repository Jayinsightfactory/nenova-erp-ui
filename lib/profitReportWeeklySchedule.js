// Report-cache calendar only. Never derive ERP weeks from ISO weeks or day-of-year.
const DAY = 86400000;
const KST = 9 * 3600000;

function invalid(message) {
  const error = new Error(`보고서 업무 달력 확인 필요: ${message}`);
  error.code = 'PROFIT_CALENDAR_INVALID';
  throw error;
}

function dateMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) invalid('날짜 형식');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) invalid('유효하지 않은 날짜');
  return ms;
}

export function kstDateOnly(now = new Date()) {
  const ms = new Date(now).getTime();
  if (!Number.isFinite(ms)) invalid('현재 시각');
  return new Date(ms + KST).toISOString().slice(0, 10);
}

export function latestWednesdaySlot(now = new Date()) {
  const ms = new Date(now).getTime();
  const today = dateMs(kstDateOnly(now));
  const daysSinceWednesday = (new Date(today).getUTCDay() - 3 + 7) % 7;
  let at = today - daysSinceWednesday * DAY + 6 * 3600000 - KST;
  if (at > ms) at -= 7 * DAY;
  const dateOnly = kstDateOnly(at);
  return { key: dateOnly, dateOnly, at: new Date(at).toISOString() };
}

function calendarIndex(rows) {
  if (!Array.isArray(rows) || !rows.length) invalid('달력 자료 없음');
  const byDate = new Map();
  const byScope = new Map();
  for (const row of rows) {
    const dateOnly = row.dateOnly;
    dateMs(dateOnly);
    const key = String(row.orderYearWeek || '');
    if (!/^\d{4}(0[1-9]|[1-4]\d|5[0-3])$/.test(key) || key.slice(0, 4) !== dateOnly.slice(0, 4)) invalid('연도·차수 불일치');
    if (byDate.has(dateOnly)) invalid(`중복 날짜 ${dateOnly}`);
    byDate.set(dateOnly, key);
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key).push(dateOnly);
  }
  return { byDate, byScope };
}

function scopeAt(index, dateOnly) {
  const key = index.byDate.get(dateOnly);
  if (!key) invalid(`날짜 누락 ${dateOnly}`);
  const dates = [...index.byScope.get(key)].sort();
  if (dates.length > 7) invalid(`차수 기간 초과 ${key}`);
  // Native PeriodDay splits weeks at Jan 1 / Dec 31; other truncated weeks are gaps.
  if (dates.length < 7 && !dates[0].endsWith('-01-01') && !dates.at(-1).endsWith('-12-31')) invalid(`차수 기간 부족 ${key}`);
  for (let i = 1; i < dates.length; i += 1) {
    if (dateMs(dates[i]) - dateMs(dates[i - 1]) !== DAY) invalid(`차수 기간 공백 ${key}`);
  }
  return { orderYear: key.slice(0, 4), major: key.slice(4), startDate: dates[0], endDate: dates.at(-1) };
}

export function resolveCurrentProfitWeek(rows, dateOnly) {
  dateMs(dateOnly);
  return scopeAt(calendarIndex(rows), dateOnly);
}

export function resolvePreviousProfitWeek(rows, current) {
  const index = calendarIndex(rows);
  const actual = scopeAt(index, current.startDate);
  if (['orderYear', 'major', 'startDate', 'endDate'].some(key => actual[key] !== current[key])) invalid('기준 차수 변경');
  const previousDate = new Date(dateMs(current.startDate) - DAY).toISOString().slice(0, 10);
  const previous = scopeAt(index, previousDate);
  if (previous.endDate !== previousDate || previous.orderYear + previous.major >= current.orderYear + current.major) invalid('직전 차수 범위');
  if (current.major !== '01') {
    if (previous.orderYear !== current.orderYear || Number(previous.major) !== Number(current.major) - 1) invalid('차수 순번 공백');
  } else if (Number(previous.orderYear) !== Number(current.orderYear) - 1) invalid('직전 연도');
  return previous;
}

export function resolveWeeklySchedule(rows, now = new Date()) {
  const slot = latestWednesdaySlot(now);
  const current = resolveCurrentProfitWeek(rows, slot.dateOnly);
  return { slot, current, target: resolvePreviousProfitWeek(rows, current) };
}

/** Read a bounded calendar window. Importing this module never opens a DB connection. */
export async function loadProfitReportCalendar(dateOnly, queryOverride) {
  const ms = dateMs(dateOnly);
  const { query, sql } = await import('./db.js');
  const from = new Date(ms - 21 * DAY).toISOString().slice(0, 10);
  const to = new Date(ms + 7 * DAY).toISOString().slice(0, 10);
  const result = await (queryOverride || query)(
    `SELECT CONVERT(CHAR(10), TRY_CONVERT(DATE, BaseYmd), 23) AS dateOnly,
            CONVERT(NVARCHAR(20), OrderYearWeek) AS orderYearWeek
       FROM PeriodDay
      WHERE TRY_CONVERT(DATE, BaseYmd) BETWEEN @fromDate AND @toDate
        AND YEAR(TRY_CONVERT(DATE, BaseYmd)) IN (@fromYear, @toYear)
      ORDER BY TRY_CONVERT(DATE, BaseYmd)`,
    {
      fromDate: { type: sql.NVarChar, value: from }, toDate: { type: sql.NVarChar, value: to },
      fromYear: { type: sql.Int, value: Number(from.slice(0, 4)) }, toYear: { type: sql.Int, value: Number(to.slice(0, 4)) },
    },
  );
  return result.recordset || [];
}
