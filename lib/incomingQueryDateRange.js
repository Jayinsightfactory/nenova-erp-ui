const koreaDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Query defaults only. Do not reuse these dates as upload inputDate defaults.
export function incomingQueryDateRange(search = '', now = new Date()) {
  const parts = Object.fromEntries(koreaDate.formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const monthIndex = Number(parts.year) * 12 + Number(parts.month) - 1 - 3;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(parts.day), lastDay);
  const from = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const query = new URLSearchParams(search);
  // Preserve the existing independent URL overrides, including older periods.
  return { startDate: query.get('from') || from, endDate: query.get('to') || today };
}
