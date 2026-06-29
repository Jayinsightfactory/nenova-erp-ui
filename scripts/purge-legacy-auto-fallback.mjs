// auto=true + prodKey 과다매핑(5+) — parse-paste 가 거부하는 legacy fallback 격리
//
//   node scripts/purge-legacy-auto-fallback.mjs           # dry-run
//   node scripts/purge-legacy-auto-fallback.mjs --apply   # 백업 후 격리

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'order-mappings.json');
const SUSPECT_FILE = path.join(__dirname, '..', 'data', 'order-mappings-fallback-suspects.json');
const FALLBACK_THRESHOLD = 5;
const APPLY = process.argv.includes('--apply');

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

function mappingCountForProdKey(map, prodKey, excludeKey = null) {
  let count = 0;
  for (const [k, v] of Object.entries(map)) {
    if (excludeKey && k === excludeKey) continue;
    if (Number(v?.prodKey) === Number(prodKey)) count += 1;
  }
  return count;
}

const toRemove = {};
for (const [key, value] of Object.entries(data)) {
  if (value?.auto !== true || !value?.prodKey) continue;
  const count = mappingCountForProdKey(data, value.prodKey, key);
  if (count >= FALLBACK_THRESHOLD) {
    toRemove[key] = { ...value, _purgedReason: 'legacy-auto-fallback', _purgedAt: new Date().toISOString() };
  }
}

const kept = { ...data };
for (const key of Object.keys(toRemove)) delete kept[key];

console.log(`# Legacy auto fallback purge ${APPLY ? '(APPLY)' : '(DRY-RUN)'}\n`);
console.log(`총 매핑: ${Object.keys(data).length}`);
console.log(`격리 대상: ${Object.keys(toRemove).length} (auto=true + prodKey ${FALLBACK_THRESHOLD}+키)\n`);

const byPk = new Map();
for (const [k, v] of Object.entries(toRemove)) {
  const pk = v.prodKey;
  if (!byPk.has(pk)) byPk.set(pk, { prodName: v.prodName, keys: [] });
  byPk.get(pk).keys.push(k);
}
for (const [pk, { prodName, keys }] of [...byPk.entries()].sort((a, b) => b[1].keys.length - a[1].keys.length)) {
  console.log(`ProdKey ${pk} (${prodName}) — ${keys.length}건`);
  for (const k of keys.slice(0, 4)) console.log(`  - "${k}"`);
  if (keys.length > 4) console.log(`  ... +${keys.length - 4}`);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 로 실행 시 백업 후 격리합니다.');
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP = path.join(path.dirname(FILE), `order-mappings.backup-${ts}.json`);
fs.writeFileSync(BACKUP, JSON.stringify(data, null, 2));
console.log(`\n✅ 백업: ${path.basename(BACKUP)}`);

let suspects = {};
if (fs.existsSync(SUSPECT_FILE)) {
  try { suspects = JSON.parse(fs.readFileSync(SUSPECT_FILE, 'utf8')); } catch { /* ignore */ }
}
const mergedSuspects = { ...suspects, ...toRemove };
fs.writeFileSync(SUSPECT_FILE, JSON.stringify(mergedSuspects, null, 2));
console.log(`✅ Suspect: ${path.basename(SUSPECT_FILE)} (${Object.keys(mergedSuspects).length}건)`);

fs.writeFileSync(FILE, JSON.stringify(kept, null, 2));
console.log(`✅ 본 파일: ${path.basename(FILE)} (${Object.keys(kept).length}건, -${Object.keys(toRemove).length})`);
