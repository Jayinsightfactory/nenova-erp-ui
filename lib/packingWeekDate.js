// Import-cycle date proposal only. Never writes an ERP ledger or invents a printed date.
const blank = value => value == null || value === '' || (typeof value === 'string' && !value.trim());
export function packingWeekScope(year, week) {
  const y = String(year ?? '').trim(), match = String(week ?? '').trim().match(/^(\d{1,2})-(0?[12])$/);
  if (!/^20\d{2}$/.test(y) || !match || +match[1] < 1 || +match[1] > 53) throw new Error('적용 연도와 세부차수(01/02)를 확인하세요.');
  const major = match[1].padStart(2, '0'), sub = match[2].padStart(2, '0');
  return { orderYear: y, orderWeek: `${major}-${sub}`, yearWeek: `${y}${major}`, weekDay: sub === '01' ? 4 : 7 };
}
export function packingCalendarDate(rows, scope) {
  const matches = rows.filter(row => String(row.OrderYearWeek) === scope.yearWeek && Number(row.WeekDay) === scope.weekDay);
  if (matches.length !== 1) throw new Error('해당 연도·차수의 전산 기준 날짜가 없거나 중복입니다.');
  const date = String(matches[0].BaseYmd ?? '').slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date
    || parsed.getUTCDay() !== scope.weekDay - 1) throw new Error('전산 달력 날짜와 요일이 일치하지 않습니다.');
  return { ...scope, date, source: 'PeriodDay', method: 'AUTO_ORDER_WEEK' };
}
export function needsPackingWeekDate(invoice) {
  return blank(invoice?.raw_date) && blank(invoice?.date);
}
export function hasPackingWeekDate(invoice) {
  const audit = invoice?.orderWeekDate;
  if (!audit || audit.method !== 'AUTO_ORDER_WEEK' || audit.source !== 'PeriodDay' || !blank(invoice.raw_date)) return false;
  try {
    const scope = packingWeekScope(audit.orderYear, audit.orderWeek);
    const checked = packingCalendarDate([{ OrderYearWeek: scope.yearWeek, WeekDay: scope.weekDay, BaseYmd: audit.date }], scope);
    return checked.date === String(invoice.date).replaceAll('/', '-');
  } catch { return false; }
}
export function applyPackingWeekDate(invoice, calendar, scope, now = new Date().toISOString()) {
  if (!needsPackingWeekDate(invoice)) return invoice;
  if (calendar?.orderYear !== scope.orderYear || calendar?.orderWeek !== scope.orderWeek || calendar?.method !== 'AUTO_ORDER_WEEK'
    || calendar?.source !== 'PeriodDay') throw new Error('날짜 조회 응답의 연도·차수가 다릅니다. 다시 조회하세요.');
  const checked = packingCalendarDate([{ OrderYearWeek: calendar.yearWeek, WeekDay: calendar.weekDay, BaseYmd: calendar.date }], scope);
  return { ...invoice, date: checked.date.replaceAll('-', '/'),
    orderWeekDate: { ...checked, originalDate: invoice.date ?? null, originalRawDate: invoice.raw_date ?? null, appliedAt: now },
    extractionIssues: (invoice.extractionIssues || []).filter(item => item.code !== 'DATE_SOURCE_UNAVAILABLE'),
  };
}
