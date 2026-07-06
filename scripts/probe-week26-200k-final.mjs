#!/usr/bin/env node
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
  port: 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

// 거래처별 견적( Date Amt ) vs 매출( Detail Amt ) — 20만 밴드
const r = await pool.request().query(`
  SELECT c.CustName,
    SUM(sd.Amount) AS detailAmt,
    SUM(ISNULL(da.dateAmt,0)) AS dateAmt,
    SUM(sd.Amount - ISNULL(da.dateAmt,0)) AS gap
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  JOIN Customer c ON c.CustKey = sm.CustKey
  OUTER APPLY (SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1
    AND LEFT(sm.OrderWeek,2)=N'26'
  GROUP BY c.CustName
  HAVING ABS(SUM(sd.Amount - ISNULL(da.dateAmt,0))) BETWEEN 50000 AND 500000
  ORDER BY ABS(SUM(sd.Amount - ISNULL(da.dateAmt,0))) DESC`);
console.log('거래처별 gap 5~50만:', r.recordset);

// repair 전 희경만 gap이었음 — 다른 행은?
const rows = await pool.request().query(`
  SELECT c.CustName, sm.OrderWeek, sd.SdetailKey, p.ProdName,
    sd.Amount, ISNULL(da.dateAmt,0) dateAmt, sd.Amount-ISNULL(da.dateAmt,0) gap,
    sd.OutQuantity, sd.Cost, sd.Descr
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Customer c ON c.CustKey=sm.CustKey
  LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
  OUTER APPLY (SELECT SUM(sdd.Amount) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1 AND LEFT(sm.OrderWeek,2)=N'26'
    AND ABS(sd.Amount-ISNULL(da.dateAmt,0))>1000
  ORDER BY ABS(sd.Amount-ISNULL(da.dateAmt,0)) DESC`);
console.log('\n행별 gap>1000:', rows.recordset);

// 26-01 vs 26-02 매출 (analysis가 서브차수만 볼 때)
const sub = await pool.request().query(`
  SELECT sm.OrderWeek, SUM(sd.Amount) amt FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  WHERE sm.isDeleted=0 AND LEFT(sm.OrderWeek,2)=N'26'
  GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek`);
console.log('\n서브차수 매출:', sub.recordset);
console.log('26-01+26-02', sub.recordset.reduce((s,r)=>s+Number(r.amt),0));

// 친구플라워 7/1 수량감소 합계
const cf = await pool.request().query(`
  SELECT SUM(sd.Amount) amt FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Customer c ON c.CustKey=sm.CustKey
  WHERE c.CustName=N'친구플라워' AND sm.OrderWeek LIKE N'26-%' AND sm.isDeleted=0`);
console.log('\n친구플라워 26차 매출:', cf.recordset[0]);

const near200 = await pool.request().query(`
  SELECT c.CustName, SUM(sd.Amount) amt FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Customer c ON c.CustKey=sm.CustKey
  WHERE sm.OrderWeek=N'26-01' AND sm.isDeleted=0
  GROUP BY c.CustName HAVING SUM(sd.Amount) BETWEEN 180000 AND 220000`);
console.log('\n26-01 거래처 매출 18~22만:', near200.recordset);

await pool.close();
