// scripts/work-drive-backfill-web-uploads.mjs — 수입부 패킹리스트 "팀 업로드 이력"에 이미 보관된 원본을 업무 드라이브(/work/drive)로 1회 소급.
// 배경(2026-11-09): 웹 화면에서 직접 올린 파일은 data/runtime/import-team/packing-uploads/files/<sha> 에만 남아 업무드라이브에 없었다.
//   이제 savePackingUpload 가 저장 시점에 mirrorWebUpload 로 드라이브에도 넣지만, 그 이전 업로드분은 이 스크립트로 한 번 넣는다.
// 동작: records/*.json 을 읽어 files/<sourceHash> 원본을 mirrorWebUpload({ user: record.actor, source: 'import/packing-list' }) 로 투입.
//   같은 sha 가 이미 드라이브에 있으면 ingestFile 이 duplicate 로 처리(중복 저장 없음). 멱등 — 여러 번 실행해도 안전.
// ERP MSSQL 은 읽지도 쓰지도 않는다. 파일만 다룬다.
// 실행(앱 루트, 운영은 컨테이너/서버 안에서):  node scripts/work-drive-backfill-web-uploads.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// lib/*.js 는 Next 전용으로 확장자 없는 상대 import('./workManuals')를 쓰므로, 노드에서 직접 읽을 수 있게 확장자를 붙여 주는 로더를 건다.
register('./work-drive-esm-loader.mjs', import.meta.url);

const dry = process.argv.includes('--dry-run');
const root = path.join(process.cwd(), 'data', 'runtime', 'import-team', 'packing-uploads');
const { mirrorWebUpload } = await import('../lib/workDrive.js');

const recDir = path.join(root, 'records');
if (!fs.existsSync(recDir)) { console.log(`records 폴더 없음: ${recDir} — 소급할 업로드가 없습니다.`); process.exit(0); }
const names = fs.readdirSync(recDir).filter((n) => n.endsWith('.json')).sort();
const seen = new Set();
const out = { records: names.length, mirrored: 0, duplicate: 0, skipped: 0, failed: 0 };
for (const n of names) {
  let rec; try { rec = JSON.parse(fs.readFileSync(path.join(recDir, n), 'utf8')); } catch (e) { out.failed++; console.warn(`읽기 실패 ${n}: ${e.message}`); continue; }
  const sha = String(rec.sourceHash || '').toLowerCase();
  const filename = rec.snapshot?.fileName || '';
  if (!/^[a-f0-9]{64}$/.test(sha) || !filename) { out.skipped++; continue; }
  if (seen.has(sha)) { out.duplicate++; continue; } // 같은 원본의 재분석 기록(새 revision)은 파일이 같으므로 한 번만
  seen.add(sha);
  const file = path.join(root, 'files', sha);
  if (!fs.existsSync(file)) { out.skipped++; console.warn(`원본 없음 ${filename} (${sha.slice(0, 8)})`); continue; }
  if (dry) { out.mirrored++; console.log(`[dry] ${rec.actor}\t${filename}\t${rec.at}`); continue; }
  const r = mirrorWebUpload({ buffer: fs.readFileSync(file), filename, user: String(rec.actor || ''), source: 'import/packing-list', mtime: rec.at || null });
  if (!r.ok) { out.failed++; console.warn(`실패 ${filename}: ${r.error}`); }
  else if (r.duplicate) { out.duplicate++; }
  else { out.mirrored++; console.log(`미러 ${rec.actor}\t${filename}\t→ ${r.classification?.cycle || '_misc'} / ${r.classification?.stage}`); }
}
console.log(JSON.stringify(out));
