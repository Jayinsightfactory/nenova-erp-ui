export function invoiceAwbIdentity(value) {
  const raw = String(value ?? '').normalize('NFKC').trim();
  if (!/^[\d\s-]+$/.test(raw)) return '';
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{11}$/.test(digits) && Number(digits.slice(3,10)) % 7 === Number(digits[10]) ? digits : '';
}
