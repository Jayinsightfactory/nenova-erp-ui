#!/usr/bin/env node
/** 7/2 호접란 7·8 확정취소/재확정 → 매출 차이(20만?) 연관 분석 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

const detail = await pool.request().query(`
  SELECT sd.SdetailKey, c.CustName, sm.OrderWeek, p.ProdKey, p.ProdName,
         sd.OutQuantity, sd.EstQuantity, sd.Cost, sd.Amount, sd.Vat,
         sd.isFix, ISNULL(sm.isFix,0) AS smFix,
         (SELECT SUM(ISNULL(sdd.Amount,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateAmt,
         (SELECT SUM(ISNULL(sdd.Vat,0)) FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) AS dateVat
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    LEFT JOIN Customer c ON sm.CustKey = c.CustKey
   WHERE sm.OrderWeek = N'26-01'
     AND ISNULL(sm.isDeleted,0)=0
     AND p.ProdName LIKE N'%ORCHID VIETNAM%'
     AND p.ProdName LIKE N'%호접%'
     AND (p.ProdName LIKE N'%White 7%' OR p.ProdName LIKE N'%White 8%' OR p.ProdName LIKE N'%화이트 7%' OR p.ProdName LIKE N'%화이트 8%')
   ORDER BY p.ProdName, c.CustName`);

console.log('=== 26-01 ORCHID VIETNAM 호접 White 7/8 — ShipmentDetail ===');
let sumAmt = 0;
let sumDate = 0;
let sumGross = 0;
for (const r of detail.recordset) {
  const amt = Number(r.Amount || 0);
  const vat = Number(r.Vat || 0);
  const dAmt = Number(r.dateAmt || 0);
  sumAmt += amt;
  sumDate += dAmt;
  sumGross += amt + vat;
  console.log(`\n[${r.SdetailKey}] ${r.CustName} | ${r.ProdName}`);
  console.log(`  out=${r.OutQuantity} est=${r.EstQuantity} cost=${r.Cost} isFix=${r.isFix}`);
  console.log(`  Detail: amt=${amt} vat=${vat} gross=${amt + vat}`);
  console.log(`  Date:   amt=${dAmt} vat=${r.dateVat} gap=${amt - dAmt}`);
}
console.log('\n--- 합계 ---');
console.log('Detail Amount:', sumAmt, 'Date Amount:', sumDate, 'gap:', sumAmt - sumDate);
console.log('Detail gross (amt+vat):', sumGross);

const stk = await pool.request().query(`
  SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, p.ProdKey, p.ProdName,
         sh.BeforeValue, sh.AfterValue, sh.Descr,
         (ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS stockDelta
    FROM StockHistory sh
    JOIN Product p ON p.ProdKey = sh.ProdKey
   WHERE sh.OrderWeek = N'26-01'
     AND sh.ChangeDtm >= '2026-07-02' AND sh.ChangeDtm < '2026-07-03'
     AND p.ProdName LIKE N'%ORCHID VIETNAM%'
     AND p.ProdName LIKE N'%호접%'
   ORDER BY sh.ChangeDtm, p.ProdName`);

console.log('\n=== 7/2 StockHistory (확정취소/재확정) ===');
const byProd = {};
for (const r of stk.recordset) {
  const delta = Number(r.stockDelta || 0);
  console.log(`${r.ChangeDtm.toISOString().slice(0, 19)} | ${r.ChangeType} | ${r.ProdName?.slice(0, 55)}`);
  console.log(`  stock ${r.BeforeValue} -> ${r.AfterValue} (delta ${delta}) | ${r.Descr}`);
  if (!byProd[r.ProdKey]) byProd[r.ProdKey] = { name: r.ProdName, deltas: [], rows: [] };
  byProd[r.ProdKey].deltas.push(delta);
  byProd[r.ProdKey].rows.push(r);
}

console.log('\n=== 매출 영향 추정 (stock delta × Cost) ===');
for (const r of detail.recordset) {
  const pk = r.ProdKey;
  const cost = Number(r.Cost || 0);
  const out = Number(r.OutQuantity || 0);
  const gross = Number(r.Amount || 0) + Number(r.Vat || 0);
  const info = byProd[pk];
  if (!info) continue;
  const netStock = info.deltas.reduce((s, d) => s + d, 0);
  const cancelRows = info.rows.filter((x) => String(x.Descr || '').includes('취소'));
  const fixRows = info.rows.filter((x) => String(x.Descr || '').includes('확정') && !String(x.Descr || '').includes('취소'));
  let cancelDelta = 0;
  let fixDelta = 0;
  for (const x of cancelRows) cancelDelta += Number(x.stockDelta || 0);
  for (const x of fixRows) fixDelta += Number(x.stockDelta || 0);
  console.log(`\nProdKey ${pk}: ${r.ProdName?.slice(0, 50)}`);
  console.log(`  Shipment OutQty=${out} Cost=${cost} Detail gross=${gross}`);
  console.log(`  Jul2 cancel stock delta=${cancelDelta} fix delta=${fixDelta} net=${netStock}`);
  console.log(`  cancel×cost gross≈${Math.round(cancelDelta * cost)} fix×cost gross≈${Math.round(fixDelta * cost)}`);
  console.log(`  → 확정취소/재확정 net stock=${netStock} → 매출금액 변동 없음(정상이면 0)`);
}

// 26차 전체 견적 vs 매출 gap reminder
const w26 = await pool.request().query(`
  SELECT
    SUM(sd.Amount) AS detailAmt,
    SUM(ISNULL(da.dateAmt,0)) AS dateAmt,
    SUM(sd.Amount - ISNULL(da.dateAmt,0)) AS gap
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  OUTER APPLY (SELECT SUM(sdd.Amount) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1
    AND LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = N'26'`);

console.log('\n=== 26차 전체 Detail vs Date gap (isFix=1) ===');
console.log(w26.recordset[0]);

// ShipmentHistory for these sdetail keys on Jul 2
if (detail.recordset.length) {
  const keys = detail.recordset.map((r) => r.SdetailKey).join(',');
  const sh = await pool.request().query(`
    SELECT CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS dt, sh.ChangeID, sh.ChangeType,
           sh.BeforeValue, sh.AfterValue, LEFT(sh.Descr,100) AS Descr, sh.SdetailKey
      FROM ShipmentHistory sh
     WHERE sh.SdetailKey IN (${keys})
       AND sh.ChangeDtm >= '2026-07-01'
     ORDER BY sh.ChangeDtm`);
  console.log('\n=== ShipmentHistory (호접 7/8, 7/1~) ===');
  console.log(sh.recordset.length ? sh.recordset : '(없음)');
}

await pool.close();
