import fs from 'fs';
import path from 'path';
import { normalizeToken } from './parseMappings.js';

const FILE = path.join(process.cwd(), 'data', 'order-import-customer-product-mappings.runtime.json');

let _cache = null;

function normalizeCustKey(custKey) {
  const value = Number(custKey);
  return Number.isInteger(value) && value > 0 ? String(value) : '';
}

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadCustomerProductMappings(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) {
      _cache = {};
      return _cache;
    }
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _cache = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    _cache = null;
    throw new Error(`업체별 품목 매칭 저장소 읽기 실패: ${error.message}`);
  }
  return _cache;
}

export function getCustomerProductMappings(custKey, forceRefresh = false) {
  const key = normalizeCustKey(custKey);
  if (!key) return {};
  const scope = loadCustomerProductMappings(forceRefresh)[key];
  return scope?.mappings && typeof scope.mappings === 'object' ? scope.mappings : {};
}

export function mergeCustomerProductMappings(globalMappings, custKey, forceRefresh = false) {
  const scoped = getCustomerProductMappings(custKey, forceRefresh);
  const markedScoped = Object.fromEntries(Object.entries(scoped).map(([key, value]) => [
    key,
    { ...value, mappingScope: 'customer' },
  ]));
  return { ...(globalMappings || {}), ...markedScoped };
}

export function saveCustomerProductMapping(custKey, inputToken, prodInfo, { custName = '' } = {}) {
  const scopeKey = normalizeCustKey(custKey);
  const mappingKey = normalizeToken(inputToken);
  if (!scopeKey) return { saved: false, reason: 'invalid-customer' };
  if (!mappingKey) return { saved: false, reason: 'empty-key' };

  const cache = { ...loadCustomerProductMappings(true) };
  const previous = cache[scopeKey] || {};
  const mappings = { ...(previous.mappings || {}) };
  mappings[mappingKey] = {
    ...prodInfo,
    mappingScope: 'customer',
    savedAt: new Date().toISOString(),
  };
  cache[scopeKey] = {
    custKey: Number(scopeKey),
    custName: String(custName || previous.custName || ''),
    mappings,
    updatedAt: new Date().toISOString(),
  };

  try {
    ensureDir();
    const temp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(temp, FILE);
    _cache = cache;
    return { saved: true, key: mappingKey, custKey: Number(scopeKey) };
  } catch (error) {
    return { saved: false, reason: 'write-error', error: error.message };
  }
}

export function deleteCustomerProductMapping(custKey, keyOrToken) {
  const scopeKey = normalizeCustKey(custKey);
  if (!scopeKey) return { deleted: false, reason: 'invalid-customer' };
  const cache = { ...loadCustomerProductMappings(true) };
  const previous = cache[scopeKey];
  if (!previous?.mappings) return { deleted: false, reason: 'not-found' };
  const key = previous.mappings[keyOrToken] ? keyOrToken : normalizeToken(keyOrToken);
  if (!previous.mappings[key]) return { deleted: false, reason: 'not-found' };

  const mappings = { ...previous.mappings };
  const removed = mappings[key];
  delete mappings[key];
  cache[scopeKey] = { ...previous, mappings, updatedAt: new Date().toISOString() };
  try {
    ensureDir();
    const temp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(temp, FILE);
    _cache = cache;
    return { deleted: true, key, removed, custKey: Number(scopeKey) };
  } catch (error) {
    return { deleted: false, reason: 'write-error', error: error.message };
  }
}
