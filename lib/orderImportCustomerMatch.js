// 붙여넣기 주문등록과 업로드 주문등록이 공유하는 거래처 매칭 규칙.
//
// 우선순위는 기존 /api/orders/parse-paste.js와 동일하다.
// 1) 사용자가 저장한 거래처 매핑
// 2) 파서가 전달한 CustKey
// 3) 공백을 제거한 거래처명 완전/부분 일치

import { findCustomerMapping, loadCustomerMappings } from './customerMappings.js';
import { normalizeCustomerToken } from './normalizeCustomerToken.js';

function normalizeCustomerName(value) {
  return normalizeCustomerToken(value);
}

function customerMatchScore(input, candidate) {
  const wanted = normalizeCustomerName(input);
  if (!wanted) return 0;
  const name = normalizeCustomerName(candidate?.CustName);
  const fields = [name, candidate?.CustCode, candidate?.OrderCode, candidate?.CustArea]
    .map(normalizeCustomerName).filter(Boolean);
  if (name === wanted) return 100;
  if (name.startsWith(wanted)) return 96;
  if (fields.some((field) => field === wanted)) return 94;
  if (name.includes(wanted)) return 88;
  if (wanted.includes(name)) return 82;
  if (fields.some((field) => field.includes(wanted) || wanted.includes(field))) return 76;
  return 0;
}

/**
 * @param {string} inputName
 * @param {Array<object>} customers
 * @param {{ inputCustKey?: number|string|null, savedMappings?: object|null }} options
 */
export function resolveImportCustomer(inputName, customers = [], {
  inputCustKey = null,
  savedMappings = null,
} = {}) {
  const list = Array.isArray(customers) ? customers : [];
  const customerByKey = new Map(list.map((customer) => [Number(customer.CustKey), customer]));
  const mappings = savedMappings || loadCustomerMappings();
  const savedMapping = findCustomerMapping(inputName, mappings);

  let customer = null;
  if (savedMapping?.value?.custKey) {
    customer = customerByKey.get(Number(savedMapping.value.custKey)) || null;
  }
  if (!customer && Number(inputCustKey) > 0) {
    customer = customerByKey.get(Number(inputCustKey)) || null;
  }

  const normalizedInput = normalizeCustomerName(inputName);
  let candidates = [];
  if (!customer && normalizedInput) {
    candidates = list.filter((candidate) => customerMatchScore(inputName, candidate) > 0);
    candidates.sort((a, b) => (
      customerMatchScore(inputName, b) - customerMatchScore(inputName, a)
      || Math.abs(normalizeCustomerName(a.CustName).length - normalizedInput.length)
      - Math.abs(normalizeCustomerName(b.CustName).length - normalizedInput.length)
      || String(a.CustName || '').localeCompare(String(b.CustName || ''), 'ko')
    ));
    customer = candidates[0] || null;
  }

  const suggestionSource = candidates.length > 0
    ? candidates
    : (customer ? [customer] : []);
  const suggestions = suggestionSource.slice(0, 8).map((candidate) => ({
    custKey: Number(candidate.CustKey),
    custName: candidate.CustName,
    custArea: candidate.CustArea || '',
    score: customerMatchScore(inputName, candidate),
  }));

  const isSavedMapping = Boolean(customer && savedMapping?.value?.custKey
    && Number(savedMapping.value.custKey) === Number(customer.CustKey));
  const isExact = Boolean(customer
    && normalizeCustomerName(customer.CustName) === normalizedInput);

  return {
    customer,
    custKey: customer ? Number(customer.CustKey) : null,
    customerName: customer?.CustName || String(inputName || ''),
    confidence: customer ? (isSavedMapping ? 100 : (isExact ? 100 : customerMatchScore(inputName, customer))) : 0,
    confidenceLabel: customer ? (isSavedMapping ? 'saved' : (isExact ? 'high' : (customerMatchScore(inputName, customer) >= 90 ? 'high' : 'medium'))) : 'none',
    fromMapping: isSavedMapping,
    mappingKey: savedMapping?.key || null,
    suggestions,
  };
}

export function loadImportCustomerMappings(forceRefresh = false) {
  return loadCustomerMappings(forceRefresh);
}
