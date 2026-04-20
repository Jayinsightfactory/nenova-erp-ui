// lib/categoryOverrides.js
// 운송기준원가 카테고리 웹 전용 오버라이드
// { [prodKey]: { category, note, savedAt } }
// Product.FlowerName 은 건드리지 않고 별도 파일에 저장.

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'category-overrides.json');
let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadOverrides() {
  if (_cache) return _cache;
  try {
    ensureDir();
    _cache = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

export function saveOverride(prodKey, category, note = '') {
  if (!prodKey) return;
  const cache = loadOverrides();
  cache[prodKey] = { category: category || null, note: note || '', savedAt: new Date().toISOString() };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[categoryOverrides] write failed:', e.message);
  }
}

export function removeOverride(prodKey) {
  if (!prodKey) return;
  const cache = loadOverrides();
  delete cache[prodKey];
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[categoryOverrides] write failed:', e.message);
  }
}

export function getOverride(prodKey) {
  return loadOverrides()[prodKey] || null;
}
