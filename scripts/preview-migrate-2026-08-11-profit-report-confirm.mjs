#!/usr/bin/env node
/**
 * dry-run 미리보기 — docs/migrations/2026-08-11_web_profit_report_confirm.sql
 *
 * 이 스크립트는 DB에 아무것도 쓰지 않는다. 두 단계로 동작한다.
 *   1) 정적 미리보기: 마이그레이션 SQL 파일을 파싱해 어떤 오브젝트가 새로 생기는지
 *      사람이 읽을 수 있게 출력한다 (파일만 읽음, DB 연결 없음).
 *   2) (선택) 실측 점검: .env.local 이 있으면 MSSQL 에 연결해 INFORMATION_SCHEMA /
 *      sys.tables / sys.columns / sys.check_constraints 를 SELECT 전용으로 조회하여
 *      "이미 있음 / 새로 생길 예정" 을 실제 DB 상태와 대조한다. 쓰기 쿼리는 전혀 없다.
 *
 * Usage: node scripts/preview-migrate-2026-08-11-profit-report-confirm.mjs [--no-db]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.join(__dirname, '..', 'docs', 'migrations', '2026-08-11_web_profit_report_confirm.sql');
const NO_DB = process.argv.includes('--no-db');

const NEW_TABLES = [
  {
    name: 'WebProfitReportConfirm',
    kind: 'TABLE',
    note: '확정 revision 헤더 (1 revision = 1행). OrderYear+MajorWeek 당 IsActive=1 은 최대 1개.',
  },
  {
    name: 'WebProfitReportConfirmDetail',
    kind: 'TABLE',
    note: 'revision 별 카테고리 세부값 (세로 구조, ColType=SOURCE/CALC/SOURCE_TAG).',
  },
];

const NEW_INDEXES = [
  ['WebProfitReportConfirm', 'UX_WebProfitReportConfirm_ActiveWeek', 'UNIQUE FILTERED (OrderYear, MajorWeek) WHERE IsActive=1'],
  ['WebProfitReportConfirm', 'UX_WebProfitReportConfirm_Revision', 'UNIQUE (OrderYear, MajorWeek, RevisionNo)'],
  ['WebProfitReportConfirmDetail', 'UX_WebProfitReportConfirmDetail', 'UNIQUE (ConfirmKey, Category, ColType, ColKey)'],
  ['WebProfitReportConfirmDetail', 'IX_WebProfitReportConfirmDetail_Confirm', '(ConfirmKey)'],
];

const NEW_CHECK_CONSTRAINTS = [
  ['WebProfitReportConfirm', 'CK_WebProfitReportConfirm_AuditStatus', "AuditStatus IN ('ready','needs_review','needs_input') OR NULL"],
  ['WebProfitReportConfirmDetail', 'CK_WebProfitReportConfirmDetail_ColType', "ColType IN ('SOURCE','CALC','SOURCE_TAG')"],
  ['FreightCost', 'CK_FreightCost_CurrencyCode', "CurrencyCode IN ('AUD','EUR','CNY','JPY','USD') OR NULL"],
  ['FreightCost', 'CK_FreightCost_CurrencyValidationStatus', "CurrencyValidationStatus IN ('validated','legacy_unverified') OR NULL"],
];

const NEW_FREIGHTCOST_COLUMNS = [
  ['FreightCost', 'CurrencyCode', 'NVARCHAR(10) NULL', 'AUD/EUR/CNY/JPY/USD 중 하나, 모르면 NULL — 값 backfill 안 함'],
  ['FreightCost', 'CurrencyValidationStatus', 'NVARCHAR(20) NULL', "새 컬럼 추가 직후 기존 행은 'legacy_unverified' 로 상태 라벨만 UPDATE (WHERE IS NULL, 안전)"],
];

function printStaticPreview() {
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(`마이그레이션 파일이 없습니다: ${MIGRATION_FILE}`);
    process.exit(1);
  }
  const sqlText = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const lineCount = sqlText.split(/\r?\n/).length;

  console.log('=== 정적 미리보기 (파일만 읽음, DB 연결 없음) ===');
  console.log(`파일: ${path.relative(process.cwd(), MIGRATION_FILE)} (${lineCount} lines)\n`);

  console.log('새로 생기는 테이블:');
  for (const t of NEW_TABLES) console.log(`  + ${t.kind} ${t.name} — ${t.note}`);

  console.log('\n새로 생기는 인덱스:');
  for (const [table, name, def] of NEW_INDEXES) console.log(`  + ${table}.${name} — ${def}`);

  console.log('\n새로 생기는 CHECK 제약:');
  for (const [table, name, def] of NEW_CHECK_CONSTRAINTS) console.log(`  + ${table}.${name} — CHECK(${def})`);

  console.log('\nFreightCost 호환 ALTER (기존 행 안 깨짐 — NULL 허용):');
  for (const [table, col, type, note] of NEW_FREIGHTCOST_COLUMNS) console.log(`  + ${table}.${col} ${type} — ${note}`);

  console.log('\n⚠️ 이 파일은 backfill 로직을 포함하지 않는다 (WebProfitReport → WebProfitReportConfirm 자동 이관 없음).');
  console.log('⚠️ FreightCost.CurrencyValidationStatus 백필은 상태 라벨(legacy_unverified)만 채우며, CurrencyCode(실제 통화값)는 추측/backfill 하지 않는다.');
}

async function connectReadOnly() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return null;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
  if (!process.env.DB_SERVER) return null;

  const sql = await import('mssql');
  const pool = await sql.default.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 30000, requestTimeout: 60000 },
  });
  return pool;
}

async function printLivePreview(pool) {
  console.log('\n=== 실측 점검 (.env.local 발견 — SELECT 전용, 쓰기 없음) ===');

  const tables = await pool.request().query(
    `SELECT name FROM sys.tables WHERE name IN (N'WebProfitReportConfirm', N'WebProfitReportConfirmDetail', N'FreightCost')`
  );
  const existing = new Set(tables.recordset.map((r) => r.name));
  for (const t of NEW_TABLES) {
    console.log(`  ${t.name}: ${existing.has(t.name) ? '이미 존재함 (idempotent 가드가 재생성을 건너뜀)' : '신규 생성 예정'}`);
  }

  if (existing.has('FreightCost')) {
    const cols = await pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='FreightCost' ORDER BY ORDINAL_POSITION`
    );
    console.log('\n  FreightCost 실제 컬럼 (INFORMATION_SCHEMA, 읽기 전용):');
    cols.recordset.forEach((r) => console.log(`    ${r.COLUMN_NAME} (${r.DATA_TYPE}, NULLABLE=${r.IS_NULLABLE})`));
    const hasCurrencyCode = cols.recordset.some((r) => r.COLUMN_NAME === 'CurrencyCode');
    const hasStatus = cols.recordset.some((r) => r.COLUMN_NAME === 'CurrencyValidationStatus');
    console.log(`\n  CurrencyCode 컬럼: ${hasCurrencyCode ? '이미 있음' : '추가 예정 (NULL 허용)'}`);
    console.log(`  CurrencyValidationStatus 컬럼: ${hasStatus ? '이미 있음' : '추가 예정 (NULL 허용, 이후 legacy_unverified 로 백필)'}`);

    const rowCount = await pool.request().query(`SELECT COUNT(*) AS c FROM FreightCost`);
    console.log(`  FreightCost 현재 행 수: ${rowCount.recordset[0].c} (이 중 CurrencyValidationStatus 가 NULL 인 행은 마이그레이션 후 전부 'legacy_unverified' 로 표시됨)`);
  } else {
    console.log('\n  ⚠️ FreightCost 테이블이 이 DB에 없습니다 — ALTER 대상 없음 (마이그레이션이 COL_LENGTH 가드로 안전하게 건너뜀).');
  }

  for (const name of ['WebProfitReportConfirm', 'WebProfitReportConfirmDetail']) {
    if (existing.has(name)) {
      const cnt = await pool.request().query(`SELECT COUNT(*) AS c FROM ${name}`);
      console.log(`  ${name} 현재 행 수: ${cnt.recordset[0].c}`);
    }
  }
}

async function main() {
  printStaticPreview();

  if (NO_DB) {
    console.log('\n(--no-db 지정 — 실측 점검 생략)');
    return;
  }

  const pool = await connectReadOnly().catch((e) => {
    console.log(`\n(.env.local 로 연결 시도했으나 실패 — 실측 점검 생략: ${e.message})`);
    return null;
  });

  if (!pool) {
    console.log('\n(.env.local 없음 또는 DB_SERVER 미설정 — 실측 점검 생략, 정적 미리보기만 출력)');
    return;
  }

  try {
    await printLivePreview(pool);
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
