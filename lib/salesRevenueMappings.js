import fs from 'fs';
import path from 'path';
import { normalizeCustomerToken } from './customerMappings';

const FILE = path.join(process.cwd(), 'data', 'sales-revenue-customer-mappings.json');

let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function normalizeRevenueCustomerName(name) {
  return normalizeCustomerToken(name);
}

export function loadSalesRevenueMappings(forceRefresh = false) {
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

export function saveSalesRevenueMapping(ecountName, mapping) {
  const key = normalizeRevenueCustomerName(ecountName);
  if (!key || !mapping?.canonicalName) return { saved: false, reason: 'missing-input' };

  const cache = loadSalesRevenueMappings(true);
  cache[key] = {
    ecountName,
    canonicalName: mapping.canonicalName,
    custKey: mapping.custKey ? parseInt(mapping.custKey, 10) : null,
    custName: mapping.custName || '',
    custArea: mapping.custArea || '',
    note: mapping.note || '',
    savedAt: new Date().toISOString(),
  };
  _cache = cache;

  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { saved: true, key, mapping: cache[key] };
  } catch (e) {
    return { saved: false, reason: 'write-error', error: e.message };
  }
}

export function deleteSalesRevenueMapping(key) {
  const cache = loadSalesRevenueMappings(true);
  if (!key || !cache[key]) return { deleted: false, reason: 'not-found' };
  delete cache[key];
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { deleted: true, key };
  } catch (e) {
    return { deleted: false, reason: 'write-error', error: e.message };
  }
}

export function findSalesRevenueMapping(ecountName, mappings = null) {
  const key = normalizeRevenueCustomerName(ecountName);
  if (!key) return null;

  const cache = mappings || loadSalesRevenueMappings();
  if (cache[key]) return { key, value: cache[key], matchType: 'exact' };

  const candidates = [];
  for (const [mapKey, value] of Object.entries(cache)) {
    if (!mapKey) continue;
    if (key.includes(mapKey) || mapKey.includes(key)) {
      candidates.push({
        key: mapKey,
        value,
        score: Math.min(key.length, mapKey.length) / Math.max(key.length, mapKey.length),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? { ...candidates[0], matchType: 'fuzzy' } : null;
}
