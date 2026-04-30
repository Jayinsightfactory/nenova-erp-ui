// scripts/clean-fallback-mappings.mjs
// 옵션 A — 명백한 fallback 2건만 자동 분리:
//   ProdKey 2946 (Credit Colombia Rose) — 63 키
//   ProdKey 338  (CARNATION Alhambra)   — 49 키
//
// 동작:
//   1. data/order-mappings.json 백업 → data/order-mappings.json.bak.<timestamp>
//   2. 두 ProdKey 의 모든 매핑을 빼서 data/order-mappings-fallback-suspects.json 으로 이동
//   3. 본 파일에서 제거
//
// --dry-run 옵션: 파일 변경 없이 결과만 출력
// 기본 실행 = APPLY (auto mode 사용자 컨펌 받은 작업)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'order-mappings.json');
const SUSPECT_FILE = path.join(__dirname, '..', 'data', 'order-mappings-fallback-suspects.json');

const DRY_RUN = process.argv.includes('--dry-run');

// 분리 대상 ProdKey (옵션 A — 가장 명백한 2건)
const REMOVE_PRODKEYS = new Set([2946, 338]);

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 분리
const kept = {};
const removed = {};
let keptCount = 0;
let removedCount = 0;

for (const [k, v] of Object.entries(data)) {
  const pk = v?.prodKey || v?.ProdKey;
  if (pk && REMOVE_PRODKEYS.has(Number(pk))) {
    removed[k] = v;
    removedCount++;
  } else {
    kept[k] = v;
    keptCount++;
  }
}

console.log(`# Fallback 매핑 분리 ${DRY_RUN ? '(DRY-RUN)' : '(APPLY)'}\n`);
console.log(`총 매핑: ${Object.keys(data).length}`);
console.log(`유지: ${keptCount}`);
console.log(`분리 대상 ProdKey: [${[...REMOVE_PRODKEYS].join(', ')}]`);
console.log(`분리: ${removedCount}\n`);

// 분리될 키 분포
const removedByPk = new Map();
for (const [k, v] of Object.entries(removed)) {
  const pk = v.prodKey || v.ProdKey;
  if (!removedByPk.has(pk)) removedByPk.set(pk, []);
  removedByPk.get(pk).push(k);
}

for (const [pk, keys] of removedByPk.entries()) {
  console.log(`ProdKey ${pk} — ${keys.length} 키 분리`);
  for (const k of keys.slice(0, 3)) console.log(`  - "${k}"`);
  if (keys.length > 3) console.log(`  ... +${keys.length - 3}`);
}

if (DRY_RUN) {
  console.log('\n[DRY-RUN] 파일 변경 없음. --dry-run 옵션 제거 시 적용.');
  process.exit(0);
}

// 백업 — 기존 패턴 (.gitignore 에 등록됨): data/order-mappings.backup-<ts>.json
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP = path.join(path.dirname(FILE), `order-mappings.backup-${ts}.json`);
fs.writeFileSync(BACKUP, JSON.stringify(data, null, 2));
console.log(`\n✅ 백업: ${path.basename(BACKUP)}`);

// suspect 파일 (이미 있으면 merge)
let existingSuspects = {};
if (fs.existsSync(SUSPECT_FILE)) {
  try { existingSuspects = JSON.parse(fs.readFileSync(SUSPECT_FILE, 'utf8')); } catch {}
}
const allSuspects = { ...existingSuspects, ...removed };
fs.writeFileSync(SUSPECT_FILE, JSON.stringify(allSuspects, null, 2));
console.log(`✅ Suspect 보관: ${path.basename(SUSPECT_FILE)} (${Object.keys(allSuspects).length} 매핑)`);

// 본 파일 갱신
fs.writeFileSync(FILE, JSON.stringify(kept, null, 2));
console.log(`✅ 본 파일 갱신: ${path.basename(FILE)} (${keptCount} 매핑)`);
console.log('\n다음 붙여넣기 시 분리된 키들은 LLM 재학습 트리거 → 정확 매핑으로 자동 복귀.');
console.log('복구 필요 시: order-mappings-fallback-suspects.json 의 항목을 본 파일에 다시 병합.');
