#!/usr/bin/env node
/** 대구희경 상차(현지상차/운임) 수정 이력 — KST */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUST_LIKE = process.argv[2] || '%희경%';
const WEEK_FILTER = process.argv[3] || ''; // e.g. 26 or 26-01

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function kst(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
});

const weekClause = WEEK_FILTER
  ? `AND (sm.OrderWeek LIKE N'${WEEK_FILTER.replace(/'/g, "''")}%' OR LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = N'${WEEK_FILTER.replace(/'/g, "''")}')`
  : '';

console.log(`=== 대구희경 상차 수정 로그 (KST) cust=${CUST_LIKE} week=${WEEK_FILTER || '전체'} ===\n`);

const cust = await pool.request()
  .input('like', sql.NVarChar, CUST_LIKE)
  .query(`SELECT CustKey, CustName, CustArea, Manager FROM Customer WHERE CustName LIKE @like ORDER BY CustName`);
console.log('【거래처】');
for (const r of cust.recordset) console.log(`  ${r.CustKey} | ${r.CustName} | ${r.CustArea || ''} | ${r.Manager || ''}`);

const sh = await pool.request()
  .input('like', sql.NVarChar, CUST_LIKE)
  .query(`
    SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
           sh.ShipmentDtm, sm.OrderWeek, sm.OrderYear, c.CustName, p.ProdName, p.ProdKey,
           sd.SdetailKey, sd.Cost, sd.Amount, sd.OutQuantity, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity
      FROM ShipmentHistory sh
      JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE c.CustName LIKE @like
       ${weekClause}
       AND (
         p.ProdName LIKE N'%상차%' OR sh.Descr LIKE N'%상차%'
         OR p.ProdName LIKE N'%운임%' OR sh.Descr LIKE N'%운임%'
         OR p.ProdName LIKE N'%현지%'
         OR p.ProdKey IN (2262, 2182)
       )
     ORDER BY sh.ChangeDtm DESC`);

console.log(`\n【ShipmentHistory — 상차/운임/현지 (${sh.recordset.length}건)】`);
for (const r of sh.recordset) {
  console.log(`\n${kst(r.ChangeDtm)} | ${r.ChangeID || '(없음)'} | ${r.ChangeType}`);
  console.log(`  차수: ${r.OrderYear || ''}-${r.OrderWeek || ''} | ${r.CustName}`);
  console.log(`  품목: [${r.ProdKey}] ${r.ProdName} | SdetailKey=${r.SdetailKey}`);
  console.log(`  변경: ${r.BeforeValue} → ${r.AfterValue}`);
  console.log(`  비고: ${r.Descr || '-'}`);
  console.log(`  현재: Out=${r.OutQuantity} Cost=${r.Cost} Amount=${r.Amount}`);
}

const shAll = await pool.request()
  .input('like', sql.NVarChar, CUST_LIKE)
  .query(`
    SELECT TOP 30 sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
           sm.OrderWeek, c.CustName, p.ProdName, sd.SdetailKey
      FROM ShipmentHistory sh
      JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE c.CustName LIKE @like
       ${weekClause}
     ORDER BY sh.ChangeDtm DESC`);

console.log(`\n【ShipmentHistory — 희경 전체 최근 30건】`);
for (const r of shAll.recordset) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${r.OrderWeek} | ${(r.ProdName || '').slice(0, 35)} | ${r.BeforeValue}→${r.AfterValue} | ${(r.Descr || '').slice(0, 50)}`);
}

try {
  const eh = await pool.request()
    .input('like', sql.NVarChar, CUST_LIKE)
    .query(`
      SELECT eh.ChangeDtm, eh.ChangeID, eh.ChangeType, eh.BeforeValue, eh.AfterValue, eh.Descr,
             e.EstimateType, sm.OrderWeek, c.CustName, p.ProdName
        FROM EstimateHistory eh
        JOIN Estimate e ON eh.EstimateKey = e.EstimateKey
        JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
        LEFT JOIN Customer c ON sm.CustKey = c.CustKey
        LEFT JOIN Product p ON e.ProdKey = p.ProdKey
       WHERE c.CustName LIKE @like
         ${weekClause}
         AND (p.ProdName LIKE N'%상차%' OR p.ProdName LIKE N'%운임%' OR eh.Descr LIKE N'%상차%')
       ORDER BY eh.ChangeDtm DESC`);
  console.log(`\n【EstimateHistory — 상차/운임 (${eh.recordset.length}건)】`);
  for (const r of eh.recordset) {
    console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${r.OrderWeek} | ${r.EstimateType} | ${r.ProdName} | ${r.BeforeValue}→${r.AfterValue} | ${r.Descr || ''}`);
  }
} catch (e) {
  console.log('\nEstimateHistory skip:', e.message);
}

try {
  const oh = await pool.request()
    .input('like', sql.NVarChar, CUST_LIKE)
    .query(`
      SELECT TOP 30 oh.ChangeDtm, oh.ChangeID, oh.BeforeValue, oh.AfterValue, oh.Descr,
             om.OrderWeek, c.CustName, p.ProdName
        FROM OrderHistory oh
        JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
        JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
        LEFT JOIN Customer c ON om.CustKey = c.CustKey
        LEFT JOIN Product p ON od.ProdKey = p.ProdKey
       WHERE c.CustName LIKE @like
         ${weekClause.replace(/sm\./g, 'om.')}
         AND (p.ProdName LIKE N'%상차%' OR oh.Descr LIKE N'%상차%' OR p.ProdName LIKE N'%운임%')
       ORDER BY oh.ChangeDtm DESC`);
  console.log(`\n【OrderHistory — 상차/운임 (${oh.recordset.length}건)】`);
  for (const r of oh.recordset) {
    console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.OrderWeek} | ${r.ProdName} | ${r.BeforeValue}→${r.AfterValue} | ${r.Descr || ''}`);
  }
} catch (e) {
  console.log('\nOrderHistory skip:', e.message);
}

for (const tbl of ['AppLog', 'ActionLog']) {
  try {
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl}'
    `);
    const names = cols.recordset.map((c) => c.COLUMN_NAME);
    const dtCol = names.includes('CreateDtm') ? 'CreateDtm' : names.includes('ChangeDtm') ? 'ChangeDtm' : null;
    const detailCol = names.find((n) => /Detail|Message|Content/i.test(n)) || 'Detail';
    if (!dtCol) continue;
    const log = await pool.request().query(`
      SELECT TOP 50 ${dtCol} AS dt, * FROM ${tbl}
       WHERE CAST(${detailCol} AS NVARCHAR(MAX)) LIKE N'%희경%'
          OR CAST(${detailCol} AS NVARCHAR(MAX)) LIKE N'%79257%'
          OR CAST(${detailCol} AS NVARCHAR(MAX)) LIKE N'%상차%'
       ORDER BY ${dtCol} DESC
    `);
    console.log(`\n【${tbl} (${log.recordset.length}건)】`);
    for (const r of log.recordset) {
      const detail = r[detailCol] || r.Detail || r.Message || '';
      console.log(`${kst(r.dt)} | ${r.Category || r.Step || ''} | ${String(detail).slice(0, 150)}`);
    }
  } catch { /* table may not exist */ }
}

await pool.close();
