import { normalizeCustomerMappingKey, normalizeCustomerToken } from './normalizeCustomerToken.js';
import { MAPPING_STORE_KEYS, readMappingDocument, mutateMappingDocument } from './mappingDbStore.js';
export { findCustomerMapping } from './pasteCustomerMappingMatch.js';

export { normalizeCustomerToken };

function normalizeCustomerPrimaryToken(t) {
  return normalizeCustomerMappingKey(t);
}

export async function loadCustomerMappings(_forceRefresh = false) {
  return readMappingDocument(MAPPING_STORE_KEYS.customers);
}

export async function saveCustomerMapping(inputToken, customerInfo) {
  const key = normalizeCustomerPrimaryToken(inputToken);
  if (!key || !customerInfo?.custKey) return { saved: false, reason: 'missing-input' };
  return mutateMappingDocument(MAPPING_STORE_KEYS.customers, cache => ({
    document: { ...cache, [key]: {
      custKey: parseInt(customerInfo.custKey),
      custName: customerInfo.custName,
      custArea: customerInfo.custArea || '',
      savedAt: new Date().toISOString(),
    } },
    result: { saved: true, key },
  }));
}

export async function deleteCustomerMapping(keyOrToken) {
  return mutateMappingDocument(MAPPING_STORE_KEYS.customers, cache => {
    let key = keyOrToken;
    if (!Object.hasOwn(cache, key)) {
      const norm = normalizeCustomerPrimaryToken(keyOrToken);
      if (Object.hasOwn(cache, norm)) key = norm;
    }
    if (!Object.hasOwn(cache, key)) return { changed: false, result: { deleted: false, reason: 'not-found' } };
    const removed = cache[key];
    const document = { ...cache };
    delete document[key];
    return { document, result: { deleted: true, key, removed } };
  });
}
