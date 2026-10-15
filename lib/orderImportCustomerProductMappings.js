import { normalizeToken } from './parseMappings.js';
import { normalizeImportMappingKey } from './orderImportMappingKey.js';
import { MAPPING_STORE_KEYS, readMappingDocument, mutateMappingDocument } from './mappingDbStore.js';

function normalizeCustKey(custKey) {
  const value = Number(custKey);
  return Number.isInteger(value) && value > 0 ? String(value) : '';
}

export async function loadCustomerProductMappings(_forceRefresh = false) {
  return readMappingDocument(MAPPING_STORE_KEYS.customerProducts);
}

export async function getCustomerProductMappings(custKey, forceRefresh = false) {
  const key = normalizeCustKey(custKey);
  if (!key) return {};
  const scope = (await loadCustomerProductMappings(forceRefresh))[key];
  return scope?.mappings && typeof scope.mappings === 'object' ? scope.mappings : {};
}

export async function mergeCustomerProductMappings(globalMappings, custKey, forceRefresh = false) {
  const scoped = await getCustomerProductMappings(custKey, forceRefresh);
  const markedScoped = Object.fromEntries(Object.entries(scoped).map(([key, value]) => [
    key, { ...value, mappingScope: 'customer' },
  ]));
  return { ...(globalMappings || {}), ...markedScoped };
}

export async function saveCustomerProductMapping(custKey, inputToken, prodInfo, { custName = '', actor = '' } = {}) {
  const scopeKey = normalizeCustKey(custKey);
  const mappingKey = normalizeImportMappingKey(inputToken);
  if (!scopeKey) return { saved: false, reason: 'invalid-customer' };
  if (!mappingKey) return { saved: false, reason: 'empty-key' };
  return mutateMappingDocument(MAPPING_STORE_KEYS.customerProducts, cache => {
    const previous = cache[scopeKey] || {};
    const mappings = { ...(previous.mappings || {}) };
    if (mappings[mappingKey]?.manual === true && prodInfo.manual !== true) {
      return { changed: false, result: { saved: false, reason: 'manual-mapping-protected' } };
    }
    const savedAt = new Date().toISOString();
    const history = [...(previous.history || [])];
    history.push({ key: mappingKey, before: mappings[mappingKey] || null,
      after: prodInfo, actor, savedAt });
    mappings[mappingKey] = {
      ...prodInfo, mappingScope: 'customer',
      sourceMatchName: String(inputToken || ''), savedAt,
    };
    const scope = { ...previous, custKey: Number(scopeKey),
      custName: String(custName || previous.custName || ''),
      mappings, history, updatedAt: savedAt };
    return { document: { ...cache, [scopeKey]: scope },
      result: { saved: true, key: mappingKey, custKey: Number(scopeKey) } };
  });
}

export async function deleteCustomerProductMapping(custKey, keyOrToken) {
  const scopeKey = normalizeCustKey(custKey);
  if (!scopeKey) return { deleted: false, reason: 'invalid-customer' };
  return mutateMappingDocument(MAPPING_STORE_KEYS.customerProducts, cache => {
    const previous = cache[scopeKey];
    if (!previous?.mappings) return { changed: false, result: { deleted: false, reason: 'not-found' } };
    const key = [keyOrToken, normalizeImportMappingKey(keyOrToken), normalizeToken(keyOrToken)]
      .find(candidate => Object.hasOwn(previous.mappings, candidate));
    if (!key) return { changed: false, result: { deleted: false, reason: 'not-found' } };
    const mappings = { ...previous.mappings };
    const removed = mappings[key];
    delete mappings[key];
    const savedAt = new Date().toISOString();
    const scope = { ...previous, mappings,
      history: [...(previous.history || []), { key, before: removed, after: null, savedAt }],
      updatedAt: savedAt };
    return { document: { ...cache, [scopeKey]: scope },
      result: { deleted: true, key, removed, custKey: Number(scopeKey) } };
  });
}
