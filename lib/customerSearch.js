import { convertQwertyInputToHangul } from './qwertyHangul.js';

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
  const hangul = normalizeCustomerSearchText(convertQwertyInputToHangul(value));
  if (hangul) terms.add(hangul);
  let cleaned = compact;
  for (const word of CUSTOMER_NOISE_WORDS) {
    cleaned = cleaned.replaceAll(normalizeCustomerSearchText(word), '');
  }
  if (cleaned && cleaned !== compact) terms.add(cleaned);

  return [...terms].filter(term => term.length > 0);
}

/**
 * 거래처를 드롭다운에서 고르면 검색어가 업체명으로 바뀐다. 그 값으로 다시 검색을 돌리면
 * 응답이 목록을 덮어써 드롭다운이 다시 열리고, 직전 검색어의 늦은 응답이 다른 업체를
 * 선택하게 만든다. 선택으로 채워진 검색어는 재검색 대상에서 제외한다.
 */
export function shouldRunCustomerSearch(query, appliedSelectionName) {
  const q = String(query ?? '');
  if (q.length < 1) return false;
  if (appliedSelectionName != null && q === String(appliedSelectionName)) return false;
  return true;
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
