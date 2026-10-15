// Pure saved-customer matching; safe for browser imports.
import { normalizeCustomerMappingKey, normalizeCustomerToken } from './normalizeCustomerToken.js';
export { normalizeCustomerToken };
function normalizeCustomerPrimaryToken(t) { return normalizeCustomerMappingKey(t); }
function mappingKeys(inputToken) {
  return Array.from(new Set([
    normalizeCustomerPrimaryToken(inputToken),
    normalizeCustomerToken(inputToken),
  ].filter(Boolean)));
}

export function findCustomerMapping(inputToken, mappings = null) {
  if (!mappings || typeof mappings !== 'object' || typeof mappings.then === 'function') {
    throw new Error('거래처 매칭 snapshot이 필요합니다.');
  }
  const keys = mappingKeys(inputToken);
  if (!keys.length) return null;
  const cache = mappings;
  for (const key of keys) {
    if (cache[key]) return { key, value: cache[key], matchType: 'exact' };
  }

  const candidates = [];
  for (const [mapKey, value] of Object.entries(cache)) {
    if (!mapKey) continue;
    for (const key of keys) {
      if (key.includes(mapKey) || mapKey.includes(key)) {
        candidates.push({
          key: mapKey,
          value,
          score: Math.min(key.length, mapKey.length) / Math.max(key.length, mapKey.length),
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best ? { key: best.key, value: best.value, matchType: 'fuzzy', score: best.score } : null;
}
