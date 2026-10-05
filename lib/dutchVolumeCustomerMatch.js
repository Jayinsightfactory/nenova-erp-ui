// Dutch workbook customer headers are exporter name/Descr-head + newline +
// OrderCode. The caller supplies current active customers; this helper does not
// load masters, trust workbook keys, or change manual-override precedence.
const normalizeToken = value => String(value ?? '')
  .replace(/\s+/g, '')
  .replace(/[()（）\[\]{}]/g, '')
  .replace(/[△☆★※＋+]/g, '')
  .toLowerCase();

/**
 * Exact, order-independent Dutch-only customer matching.
 * Two known tokens must identify one common CustKey. An unknown/stale code can
 * use a unique exact name/alias, but is never treated as a code suffix (CL2 is
 * not YCL2 or CL22). Unknown names can similarly use one exact current code.
 * Duplicate candidates and contradictory known tokens fail closed.
 * Returns the original customer object or null; no fuzzy/weekly fallback.
 */
export function matchDutchCustomer(customers, label) {
  const lines = String(label ?? '').split(/\r\n|\n|\r/).map(value => value.trim()).filter(Boolean);
  if (!lines.length || lines.length > 2) return null;
  const nameToken = normalizeToken(lines[0]);
  const codeToken = normalizeToken(lines.length === 2 ? lines[1] : lines[0]);
  if (!nameToken || !codeToken) return null;

  const names = new Map();
  const codes = new Map();
  for (const customer of customers || []) {
    const key = Number(customer?.CustKey);
    if (!Number.isSafeInteger(key) || key <= 0) continue;
    const aliases = [customer.CustName, String(customer.Descr || '').split('/')[0]];
    if (aliases.some(alias => normalizeToken(alias) === nameToken)) names.set(key, customer);
    if (normalizeToken(customer.OrderCode) === codeToken) codes.set(key, customer);
  }

  // Without a newline the one token may be either a name or an order code;
  // do not arbitrarily prefer one interpretation if they identify two masters.
  if (lines.length === 1) {
    const candidates = new Map([...names, ...codes]);
    return candidates.size === 1 ? [...candidates.values()][0] : null;
  }
  if (names.size && codes.size) {
    const common = [...names].filter(([key]) => codes.has(key));
    return common.length === 1 ? common[0][1] : null;
  }
  const candidates = names.size ? names : codes;
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
