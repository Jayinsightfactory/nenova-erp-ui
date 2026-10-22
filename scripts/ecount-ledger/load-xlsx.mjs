// 이카운트 엑셀 → ecount.Raw_<PrgId> 적재. 이카운트에는 쓰지 않는다(우리 DB ecount 스키마만).
// 사용: node scripts/ecount-ledger/load-xlsx.mjs <prgId> <file.xlsx> [--from YYYY-MM-DD --to YYYY-MM-DD --source xlsx] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, parseArgs } from './_env.mjs';

loadEnv();
const { pos, opt } = parseArgs(process.argv.slice(2));
const [prgId, file] = pos;
if (!prgId || !file) { console.error('사용: load-xlsx.mjs <prgId> <file.xlsx> [--from --to --source] [--dry-run]'); process.exit(2); }
const dateOk = (s) => s === undefined || /^\d{4}-\d{2}-\d{2}$/.test(String(s));
if (!dateOk(opt.from) || !dateOk(opt.to)) { console.error('--from/--to 는 YYYY-MM-DD'); process.exit(2); }

const { parseEcountXlsx } = await import('../../lib/ecountLedger/xlsx.js');
const { prepareRows } = await import('../../lib/ecountLedger/loader.js');
const buf = fs.readFileSync(file);
const parsed = parseEcountXlsx(buf);
if (!parsed.headers.length) { console.error('헤더 행을 찾지 못했습니다.'); process.exit(1); }
const prep = prepareRows(prgId, parsed.headers, parsed.rows);
console.log(`헤더 ${parsed.headers.length}열, 행 ${prep.items.length}(합계행 ${prep.items.filter((i) => i.isSubtotal).length}), screenTotal=${parsed.screenTotal}`);
if (opt['dry-run']) { console.log('열:', prep.names.join(' | ')); process.exit(0); }

const { loadRows } = await import('../../lib/ecountLedger/loader.js');
const { query, getPool } = await import('../../lib/db.js');
try {
  const r = await loadRows({
    prgId, headers: parsed.headers, rows: parsed.rows,
    batchMeta: {
      source: opt.source || 'xlsx', fileName: path.basename(file), fileSha256: parsed.sha256,
      periodFrom: opt.from || null, periodTo: opt.to || null, screenTotal: parsed.screenTotal,
      loadedBy: process.env.USERNAME || 'cli',
    },
  });
  console.log('적재 완료', r);
} catch (e) {
  if (/UX_ecount_LoadBatch_FileSha256|duplicate key/i.test(String(e.message))) console.error('이미 적재된 파일입니다(FileSha256 중복).');
  else console.error('실패:', e.message);
  process.exitCode = 1;
}
void query; (await getPool()).close();
