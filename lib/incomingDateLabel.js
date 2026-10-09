// Presentation only: retain the ERP calendar date without local/UTC conversion.
export function incomingDateLabel(value) {
  if (value == null || value === '') return '—';
  const raw = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=$|T| )/.exec(raw);
  if (!match) return raw;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return raw;
  return raw.slice(0, 10);
}
