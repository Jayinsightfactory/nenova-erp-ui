// 주차별 매출이익보고서 전용 품목 분류 오버라이드.
// Product.CounName/FlowerName을 바꾸지 않아 nenova.exe와 공용 품목마스터를 보존한다.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'profit-report-category-overrides.json');
let cache = null;

function loadFile(force = false) {
  if (cache && !force) return cache;
  try { cache = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {}; }
  catch { cache = {}; }
  return cache;
}

export function loadProfitCategoryOverrides(force = false) {
  return loadFile(force);
}

export function saveProfitCategoryOverride(prodKey, category, context = {}) {
  const key = Number(prodKey);
  if (!Number.isInteger(key) || key <= 0) throw new Error('올바른 품목키가 필요합니다.');
  const next = { ...loadFile(true), [String(key)]: {
    category: String(category),
    orderYear: String(context.orderYear || ''),
    majorWeek: String(context.majorWeek || ''),
    savedBy: String(context.savedBy || '').slice(0, 100),
    savedAt: new Date().toISOString(),
  } };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temp, FILE);
  cache = next;
  return next[String(key)];
}

export function buildProfitOverrideCaseSql(baseSql, alias = 'p', allowedCategories = []) {
  return buildProfitOverrideCaseSqlFromMap(baseSql, alias, allowedCategories, loadFile());
}

export function buildProfitOverrideCaseSqlFromMap(baseSql, alias = 'p', allowedCategories = [], overrides = {}) {
  const allowed = new Set(allowedCategories.map(String));
  const rows = Object.entries(overrides || {})
    .filter(([key, value]) => /^\d+$/.test(key) && value?.category && allowed.has(String(value.category)))
    .map(([key, value]) => ({ key: Number(key), category: String(value.category).replace(/'/g, "''") }))
    .filter(row => Number.isSafeInteger(row.key) && row.key > 0);
  if (!rows.length) return baseSql;
  const clauses = rows.map(row => `WHEN ${alias}.ProdKey=${row.key} THEN N'${row.category}'`).join(' ');
  return `CASE ${clauses} ELSE (${baseSql}) END`;
}
