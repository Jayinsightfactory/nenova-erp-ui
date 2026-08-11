/**
 * 잔량분배 게시판 — 기준업체 CustKey 오연결 복구 실행기 (웹 전용 설정 원장만)
 * node scripts/run-web-board-custkey-repair.mjs [--apply]
 *
 * --apply 없이 실행하면 변경 없이 현재 상태만 보여준다.
 * 대상: dbo.WebShillaMiuBoardGroup 의 BaseCustKey/BaseCustName
 * ERP 원장(Customer, Order·Shipment·Stock 계열, Estimate, WebProfitReport)은 읽기만 한다.
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const apply = process.argv.includes('--apply');
const migration = fs.readFileSync(
  path.join(root, 'docs/migrations/2026-08-11_web_board_group_custkey_repair.sql'),
  'utf8',
);

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
});

const show = async (label) => {
  const r = await pool.request().query(
    `SELECT GroupKey, GroupName, BaseCustKey, BaseCustName, ReceiverCustKey, ReceiverCustName,
            IsActive, DisplayOrder, UpdatedBy, UpdatedAt
       FROM dbo.WebShillaMiuBoardGroup ORDER BY DisplayOrder, GroupKey`,
  );
  console.log(`\n=== ${label} ===`);
  console.table(r.recordset);
  return r.recordset;
};

await show('변경 전 WebShillaMiuBoardGroup');

if (!apply) {
  console.log('\n[dry-run] --apply 를 붙여야 실제로 갱신합니다. 변경 없음.');
} else {
  const result = await pool.request().query(migration);
  console.log(`\n[apply] 마이그레이션 실행 완료. rowsAffected=${JSON.stringify(result.rowsAffected)}`);
  await show('변경 후 WebShillaMiuBoardGroup');
}

await pool.close();
