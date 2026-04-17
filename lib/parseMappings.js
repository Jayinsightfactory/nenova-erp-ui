// lib/parseMappings.js
// 붙여넣기 주문 파싱 매핑 캐시 (서버 공유)
// inputToken → { prodKey, prodName, displayName, flowerName, counName, savedAt }

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'order-mappings.json');

// 메모리 캐시
let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadMappings() {
  if (_cache) return _cache;
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      _cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }
  return _cache;
}

export function saveMapping(inputToken, prodInfo) {
  const cache = loadMappings();
  const key = normalizeToken(inputToken);
  if (!key) return;
  cache[key] = { ...prodInfo, savedAt: new Date().toISOString() };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[parseMappings] write failed:', e.message);
  }
}

export function getMapping(inputToken) {
  const cache = loadMappings();
  return cache[normalizeToken(inputToken)] || null;
}

export function normalizeToken(t) {
  return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
