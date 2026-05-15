const CUSTOMER_NOISE_WORDS = [
  '여분코드',
  '여분 코드',
  '여분',
  '추가코드',
  '추가 코드',
];

export function normalizeCustomerSearchText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\]{}]/g, '')
    .trim();
}

export function getCustomerSearchTerms(value = '') {
  const compact = normalizeCustomerSearchText(value);
  if (!compact) return [];

  const terms = new Set([compact]);
  let cleaned = compact;
  for (const word of CUSTOMER_NOISE_WORDS) {
    cleaned = cleaned.replaceAll(normalizeCustomerSearchText(word), '');
  }
  if (cleaned && cleaned !== compact) terms.add(cleaned);

  return [...terms].filter(term => term.length > 0);
}

export function customerMatchesSearch(customer, rawKeyword = '') {
  const terms = getCustomerSearchTerms(rawKeyword);
  if (terms.length === 0) return true;

  const fields = [
    customer?.CustName,
    customer?.CustCode,
    customer?.CustArea,
    customer?.Manager,
    customer?.OrderCode,
  ].map(normalizeCustomerSearchText).filter(Boolean);

  return terms.some(term => fields.some(field => field.includes(term) || term.includes(field)));
}
