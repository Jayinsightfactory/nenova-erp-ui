import fs from 'fs';
import path from 'path';
import { normalizeCustomerToken } from './normalizeCustomerToken.js';

export { normalizeCustomerToken };

const FILE = path.join(process.cwd(), 'data', 'customer-mappings.json');

let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeCustomerPrimaryToken(t) {
  return normalizeCustomerToken(String(t || '').split(/[\/／]/)[0]);
}

function mappingKeys(inputToken) {
  return Array.from(new Set([
    normalizeCustomerPrimaryToken(inputToken),
    normalizeCustomerToken(inputToken),
  ].filter(Boolean)));
}

export function loadCustomerMappings(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  try {
    ensureDir();
    _cache = fs.existsSync(FILE)
      ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
      : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

export function saveCustomerMapping(inputToken, customerInfo) {
  const key = normalizeCustomerPrimaryToken(inputToken);
  if (!key || !customerInfo?.custKey) return { saved: false, reason: 'missing-input' };
  const cache = loadCustomerMappings(true);
  cache[key] = {
    custKey: parseInt(customerInfo.custKey),
    custName: customerInfo.custName,
    custArea: customerInfo.custArea || '',
    savedAt: new Date().toISOString(),
  };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { saved: true, key };
  } catch (e) {
    return { saved: false, reason: 'write-error', error: e.message };
  }
}

export function deleteCustomerMapping(keyOrToken) {
  const cache = loadCustomerMappings();
  let key = keyOrToken;
  if (!(key in cache)) {
    const norm = normalizeCustomerPrimaryToken(keyOrToken);
    if (norm in cache) key = norm;
  }
  if (!(key in cache)) return { deleted: false, reason: 'not-found' };
  const removed = cache[key];
  delete cache[key];
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { deleted: true, key, removed };
  } catch (e) {
    return { deleted: false, reason: 'write-error', error: e.message };
  }
}

export function findCustomerMapping(inputToken, mappings = null) {
  const keys = mappingKeys(inputToken);
  if (!keys.length) return null;
  const cache = mappings || loadCustomerMappings();
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
