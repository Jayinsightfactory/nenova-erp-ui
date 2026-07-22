// 붙여넣기 주문등록과 업로드 주문등록이 공유하는 거래처 매칭 규칙.
//
// 우선순위는 기존 /api/orders/parse-paste.js와 동일하다.
// 1) 사용자가 저장한 거래처 매핑
// 2) 파서가 전달한 CustKey
// 3) 공백을 제거한 거래처명 완전/부분 일치

import { findCustomerMapping, loadCustomerMappings } from './customerMappings.js';

function normalizeCustomerName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
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
    candidates = list.filter((candidate) => {
      const normalizedCandidate = normalizeCustomerName(candidate.CustName);
      return normalizedCandidate === normalizedInput
        || normalizedCandidate.includes(normalizedInput)
        || normalizedInput.includes(normalizedCandidate);
    });
    candidates.sort((a, b) => (
      Math.abs(normalizeCustomerName(a.CustName).length - normalizedInput.length)
      - Math.abs(normalizeCustomerName(b.CustName).length - normalizedInput.length)
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
    score: normalizeCustomerName(candidate.CustName) === normalizedInput ? 100 : 78,
  }));

  const isSavedMapping = Boolean(customer && savedMapping?.value?.custKey
    && Number(savedMapping.value.custKey) === Number(customer.CustKey));
  const isExact = Boolean(customer
    && normalizeCustomerName(customer.CustName) === normalizedInput);

  return {
    customer,
    custKey: customer ? Number(customer.CustKey) : null,
    customerName: customer?.CustName || String(inputName || ''),
    confidence: customer ? (isSavedMapping ? 100 : (isExact ? 100 : 78)) : 0,
    confidenceLabel: customer ? (isSavedMapping ? 'saved' : (isExact ? 'high' : 'medium')) : 'none',
    fromMapping: isSavedMapping,
    mappingKey: savedMapping?.key || null,
    suggestions,
  };
}

export function loadImportCustomerMappings(forceRefresh = false) {
  return loadCustomerMappings(forceRefresh);
}
