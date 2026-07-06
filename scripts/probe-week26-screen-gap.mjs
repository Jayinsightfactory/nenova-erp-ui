#!/usr/bin/env node
/** 견적 목록(Cost×qty) vs 매출분석(ShipmentDetail.Amount) 차이 — 20만원급 찾기 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] || '26';

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
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
});

const parentFilter = `LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = N'${PW}'`;

// 거래처별: 견적헤더 산식 vs Detail.Amount
const byCust = await pool.request().query(`
  SELECT c.CustName,
    SUM(sd.Amount) AS detailAmt,
    SUM(ROUND(ISNULL(p.Cost,0) * CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
      WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity ELSE sd.BoxQuantity END / 1.1, 0)) AS costQtyAmtApprox,
    SUM(ISNULL(p.Cost,0) * CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
      WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity ELSE sd.BoxQuantity END) AS costQtyGross,
    SUM(ISNULL(da.dateAmt,0)) AS dateAmt
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  JOIN Customer c ON sm.CustKey = c.CustKey
  LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
  OUTER APPLY (SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1 AND ${parentFilter}
  GROUP BY c.CustName
  ORDER BY ABS(SUM(sd.Amount) - SUM(ISNULL(da.dateAmt,0))) DESC`);

console.log('=== 거래처별 Detail vs Date gap TOP ===');
for (const r of byCust.recordset.slice(0, 10)) {
  const gap = Number(r.detailAmt) - Number(r.dateAmt);
  if (Math.abs(gap) > 0) console.log(r.CustName, 'detail', r.detailAmt, 'date', r.dateAmt, 'gap', gap);
}

// 행별 Detail vs Date (현재)
const rowGap = await pool.request().query(`
  SELECT TOP 20 c.CustName, sm.OrderWeek, sd.SdetailKey, p.ProdName,
    sd.Amount detailAmt, sd.OutQuantity, sd.Cost,
    ISNULL(da.dateAmt,0) dateAmt,
    sd.Amount - ISNULL(da.dateAmt,0) gap
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  JOIN Customer c ON sm.CustKey = c.CustKey
  LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
  OUTER APPLY (SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1 AND ${parentFilter}
    AND ABS(sd.Amount - ISNULL(da.dateAmt,0)) > 0
  ORDER BY ABS(sd.Amount - ISNULL(da.dateAmt,0)) DESC`);
console.log('\n=== 행별 Detail≠Date (현재) ===');
console.log(rowGap.recordset);

// 견적 헤더 totalAmount vs Detail.Amount (전체)
const totals = await pool.request().query(`
  SELECT
    SUM(sd.Amount) detailAmt,
    SUM(ISNULL(p.Cost,0)*CASE WHEN sd.BunchQuantity>0 THEN sd.BunchQuantity
      WHEN sd.SteamQuantity>0 THEN sd.SteamQuantity ELSE sd.BoxQuantity END) costQtyGross,
    SUM(ISNULL(ea.estGross,0)) estGross
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
  OUTER APPLY (SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)) estGross FROM Estimate e WHERE e.ShipmentKey=sm.ShipmentKey) ea
  WHERE sm.isDeleted=0 AND sm.isFix=1 AND ${parentFilter}`);
const t = totals.recordset[0];
const estListTotal = Number(t.costQtyGross) + Number(t.estGross);
console.log('\n=== 견적 목록 헤더 vs 매출분석 ===');
console.log('Detail.Amount (매출분석):', t.detailAmt);
console.log('Cost×qty gross + Estimate gross (견적헤더 근사):', estListTotal);
console.log('gap:', Number(t.detailAmt) - estListTotal + Number(t.estGross)); // rough

// 희경 repair 전 gap 복원: ShipmentHistory shows wrong date amount was 134545 vs detail 1345455
// 1 box 현지상차 cost
const hk = await pool.request().query(`
  SELECT sd.*, c.CustName FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Customer c ON c.CustKey=sm.CustKey WHERE sd.SdetailKey=79257`);
const h = hk.recordset[0];
const oneBoxAmt = Math.round(Number(h.Cost) / 1.1); // if 1 box
console.log('\n희경 현지상차: cost', h.Cost, 'out', h.OutQuantity, 'amount', h.Amount);
console.log('1박스 공급가(추정):', oneBoxAmt, '75-74=', oneBoxAmt);

// Jul1-3 ops with 180k-220k
const jul = await pool.request().query(`
  SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
         c.CustName, sm.OrderWeek, p.ProdName, sd.SdetailKey, sd.Cost
  FROM ShipmentHistory sh
  JOIN ShipmentDetail sd ON sh.SdetailKey=sd.SdetailKey
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  LEFT JOIN Customer c ON sm.CustKey=c.CustKey
  LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
  WHERE ${parentFilter.replace(/sm\./g,'sm.')} AND sh.ChangeDtm>='2026-07-01' AND sh.ChangeDtm<'2026-07-04'
  ORDER BY sh.ChangeDtm`);
console.log('\n=== 7/1~7/3 전체 ShipmentHistory ===');
for (const row of jul.recordset) {
  const b = Number(row.BeforeValue), a = Number(row.AfterValue);
  if (!Number.isFinite(b) || !Number.isFinite(a)) {
    console.log(row.ChangeDtm.toISOString().slice(0,19), row.ChangeID, row.CustName, row.ChangeType, row.BeforeValue,'->',row.AfterValue, row.Descr||'');
    continue;
  }
  const dq = a - b;
  const amt = Math.round(dq * Number(row.Cost || 0) / 1.1);
  console.log(row.ChangeDtm.toISOString().slice(0,19), row.ChangeID, row.CustName, row.ProdName?.slice(0,40));
  console.log(' ', row.ChangeType, b,'->',a, 'Δamt', amt, row.Descr||'');
}

await pool.close();
