import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MASTER_TABLE_RE = /\b(OrderMaster|ShipmentMaster|WarehouseMaster|StockMaster)\b/i;
const WRITE_OR_LOCK_RE = /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|MERGE)\b|\b(?:UPDLOCK|HOLDLOCK|ROWLOCK)\b/i;
const MASTER_KEY_REUSE_RE = /\bSELECT\b[\s\S]*?\b(?:OrderMasterKey|ShipmentKey|WarehouseKey|StockKey)\b[\s\S]*?\bFROM\s+(?:OrderMaster|ShipmentMaster|WarehouseMaster|StockMaster)\b/i;
const WEEK_FILTER_RE = /\b(?:\w+\.)?OrderWeek\s*(?:=|<>|!=|<|>|<=|>=|\bBETWEEN\b|\bIN\b|\bLIKE\b)/i;
const MASTER_INSERT_WEEK_RE = /\bINSERT\s+INTO\s+(?:OrderMaster|ShipmentMaster|WarehouseMaster|StockMaster)\s*\([^)]*\bOrderWeek\b[^)]*\)/i;
const YEAR_RE = /\bOrderYear\b/i;
const EXCEPTION_MARKER = 'ERP_YEAR_SCOPE: primary-key';

function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

export function findUnsafeSqlBlocks(source, file = '<memory>') {
  const findings = [];
  const templates = source.matchAll(/`([\s\S]*?)`/g);
  for (const match of templates) {
    const sql = match[1];
    if (!MASTER_TABLE_RE.test(sql) || !(WRITE_OR_LOCK_RE.test(sql) || MASTER_KEY_REUSE_RE.test(sql))) continue;
    const weekScoped = WEEK_FILTER_RE.test(sql) || MASTER_INSERT_WEEK_RE.test(sql);
    if (!weekScoped || YEAR_RE.test(sql) || sql.includes(EXCEPTION_MARKER)) continue;
    findings.push({
      file,
      line: lineAt(source, match.index || 0),
      sql: sql.replace(/\s+/g, ' ').trim().slice(0, 240),
    });
  }
  return findings;
}

function collectApiFiles(root, changedFrom) {
  let names;
  if (changedFrom) {
    // 기준 커밋과 현재 작업트리/HEAD를 비교한다. 로컬 미커밋 변경과 CI 커밋을 같은 방식으로 검사한다.
    names = execFileSync('git', ['diff', '--name-only', changedFrom], {
      cwd: root,
      encoding: 'utf8',
    }).split(/\r?\n/);
  } else {
    names = execFileSync('git', ['ls-files', 'pages/api'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  }
  return names
    .map((name) => name.trim().replace(/\\/g, '/'))
    .filter((name) => /^pages\/api\/.*\.(?:js|ts)$/.test(name))
    .filter((name) => fs.existsSync(path.join(root, name)));
}

function parseArgs(argv) {
  const at = argv.indexOf('--changed-from');
  return { changedFrom: at >= 0 ? argv[at + 1] : '' };
}

function main() {
  const root = process.cwd();
  const { changedFrom } = parseArgs(process.argv.slice(2));
  const files = collectApiFiles(root, changedFrom);
  const findings = files.flatMap((file) =>
    findUnsafeSqlBlocks(fs.readFileSync(path.join(root, file), 'utf8'), file)
  );

  if (findings.length) {
    console.error('ERP 연도 스코프 계약 위반: OrderWeek를 쓰기/잠금 기준으로 사용할 때 OrderYear가 필요합니다.');
    for (const item of findings) console.error(`- ${item.file}:${item.line} ${item.sql}`);
    console.error(`PK로 이미 한 행을 확정한 안전한 조회만 SQL 안에 /* ${EXCEPTION_MARKER} */ 근거를 남길 수 있습니다.`);
    process.exitCode = 1;
    return;
  }

  console.log(`ERP write scope guard passed (${files.length} changed API files checked)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) main();
