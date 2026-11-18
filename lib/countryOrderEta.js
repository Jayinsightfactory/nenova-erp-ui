const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const COUNTRY_ORDER_ETA_STORAGE = 'nenova.country-order-eta.v1';
export function parseCountryOrderEta(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw new Error('ETA를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1900) throw new Error('ETA를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.');
  return date;
}
export function formatCountryOrderEta(value) {
  const date = parseCountryOrderEta(value);
  return `ETA (${date.toISOString().slice(0, 10)} ${DAYS[date.getUTCDay()]})`;
}
export function countryOrderEtaDefault(saved, { year, week, cycleStart }) {
  try {
    if (saved && Number(saved.year) === Number(year) && saved.week === week) {
      parseCountryOrderEta(saved.date); return saved.date;
    }
    if (!cycleStart) return '';
    const start = parseCountryOrderEta(cycleStart);
    if (saved) {
      const date = parseCountryOrderEta(saved.date), anchor = parseCountryOrderEta(saved.cycleStart);
      return new Date(date.getTime() + start.getTime() - anchor.getTime()).toISOString().slice(0, 10);
    }
    return new Date(start.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  } catch {
    try { return new Date(parseCountryOrderEta(cycleStart).getTime() + 7 * 86400000).toISOString().slice(0, 10); }
    catch { return ''; }
  }
}
/** Copy only workbook/sheet/title; never mutate source cells, quantities or formulas. */
export function withCountryOrderEta(workbook, week, date) {
  const label = formatCountryOrderEta(date);
  if (!/^\d{1,2}-\d+[^\s]*$/u.test(week)) throw new Error('다운로드 차수를 다시 선택하세요.');
  const Sheets = { ...workbook.Sheets };
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name], title = sheet?.A1;
    if (typeof title?.v !== 'string' || !title.v.includes(`Semana ${week}차`)) throw new Error('발주서 제목의 차수가 현재 선택과 다릅니다. 다시 생성하세요.');
    Sheets[name] = { ...sheet, A1: { ...title, v: title.v.replace(/\s+ETA\s*\([^)]*\)\s*$/, '') + ` ${label}` } };
    Sheets[name]['!rows'] = [...(sheet['!rows'] ?? [])];
    Sheets[name]['!rows'][0] = { ...sheet['!rows']?.[0], hpt: Math.max(60, sheet['!rows']?.[0]?.hpt ?? 0) };
    delete Sheets[name].A1.w;
  }
  return { ...workbook, Sheets };
}
export function countryOrderSourceComplete(response) {
  const count = response?.diagnostics?.hiddenOrderCount;
  return count === 0 && !(response?.warnings ?? []).some(value => String(value).startsWith('HIDDEN_NATIVE_ORDERS:'));
}
