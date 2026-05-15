import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'customer-mappings.json');

let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function normalizeCustomerToken(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
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
  const key = normalizeCustomerToken(inputToken);
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

export function findCustomerMapping(inputToken, mappings = null) {
  const key = normalizeCustomerToken(inputToken);
  if (!key) return null;
  const cache = mappings || loadCustomerMappings();
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
  const best = candidates[0];
  return best ? { key: best.key, value: best.value, matchType: 'fuzzy', score: best.score } : null;
}
