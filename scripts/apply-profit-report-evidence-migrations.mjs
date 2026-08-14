#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationFiles = Object.freeze([
  'docs/migrations/2026-08-13_profit_report_evidence_rag.sql',
  'docs/migrations/2026-08-13_web_customs_rate_history.sql',
]);
const apply = process.argv.includes('--apply');

function loadLocalEnv() {
  const envFile = path.join(root, '.env.local');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
}

function batchesFor(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!/SET\s+XACT_ABORT\s+ON/i.test(source) || !/BEGIN\s+TRANSACTION/i.test(source) || !/COMMIT\s+TRANSACTION/i.test(source)) {
    throw new Error(`트랜잭션 보호가 없는 마이그레이션입니다: ${relativePath}`);
  }
  return source.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}

loadLocalEnv();
const planned = migrationFiles.map((file) => ({ file, batches: batchesFor(file) }));
console.log(`주차별 손익 근거 스키마: ${apply ? '적용' : '미리보기'} (${planned.length}개 파일)`);
for (const item of planned) console.log(`- ${item.file} (${item.batches.length}개 묶음)`);
if (!apply) process.exit(0);

for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key}가 없어 스키마 적용을 중단했습니다.`);
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

try {
  for (const item of planned) {
    for (const batch of item.batches) await pool.request().query(batch);
    console.log(`적용 완료: ${item.file}`);
  }
  const probe = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.WebStockPriceEvidence',N'U') IS NOT NULL THEN 1 ELSE 0 END AS StockPriceEvidence,
      CASE WHEN OBJECT_ID(N'dbo.WebCustomsRateHistory',N'U') IS NOT NULL THEN 1 ELSE 0 END AS CustomsRateHistory,
      CASE WHEN COL_LENGTH(N'dbo.WebProfitReport',N'SourceRef') IS NOT NULL
             AND COL_LENGTH(N'dbo.WebProfitReport',N'EffectiveAt') IS NOT NULL
             AND COL_LENGTH(N'dbo.WebProfitReport',N'ConfirmedBy') IS NOT NULL
             AND COL_LENGTH(N'dbo.WebProfitReport',N'ConfirmedAt') IS NOT NULL THEN 1 ELSE 0 END AS ReportProvenance`);
  const row = probe.recordset[0] || {};
  if (Number(row.StockPriceEvidence) !== 1 || Number(row.CustomsRateHistory) !== 1 || Number(row.ReportProvenance) !== 1) {
    throw new Error(`적용 후 스키마 확인 실패: ${JSON.stringify(row)}`);
  }
  console.log('스키마 확인 완료: 재고단가 근거·환율 이력·보고서 출처 열');
} finally {
  await pool.close();
}
