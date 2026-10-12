#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const q = async (title, text) => {
    try {
      const r = await pool.request().query(text);
      console.log(`\n===== ${title} =====`);
      console.log(JSON.stringify(r.recordset, null, 2));
    } catch (e) { console.log(`\n===== ${title} ERROR =====\n${e.message}`); }
  };

  await q('Zurigo 33-01 출고행', `
    SELECT sd.SdetailKey, c.CustName, sd.OutQuantity, sd.EstQuantity, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
           sd.isFix, sm.isFix AS masterFix, sm.OrderWeek
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      LEFT JOIN Customer c ON sm.CustKey=c.CustKey
     WHERE sd.ProdKey=504 AND sm.OrderYear='2026' AND sm.OrderWeek='33-01'
     ORDER BY sd.SdetailKey`);

  await q('Scarlete 차수별 출고/입고/라이브', `
    SELECT sm.OrderWeek, SUM(sd.OutQuantity) outQty,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN sd.OutQuantity ELSE 0 END) outFix,
           COUNT(*) rows
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
     WHERE sd.ProdKey=1052 AND sm.OrderYear='2026' AND sm.OrderWeek IN ('32-02','33-01','33-02','34-01')
     GROUP BY sm.OrderWeek
     ORDER BY sm.OrderWeek`);

  await q('Scarlete 최근 StockHistory', `
    SELECT TOP 20 ChangeDtm, ChangeID, ChangeType, OrderWeek, BeforeValue, AfterValue, Descr
      FROM StockHistory WHERE ProdKey=1052 AND OrderYear='2026'
     ORDER BY ChangeDtm DESC`);

  await q('Zurigo 최근 StockHistory', `
    SELECT TOP 15 ChangeDtm, ChangeID, ChangeType, OrderWeek, BeforeValue, AfterValue, Descr
      FROM StockHistory WHERE ProdKey=504 AND OrderYear='2026'
     ORDER BY ChangeDtm DESC`);

  await q('live 음수 카네이션', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, CAST(p.Stock AS decimal(18,4)) live
      FROM Product p
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0)<0
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%' OR p.ProdName LIKE N'%CARNATION%')
     ORDER BY p.Stock`);

  await q('33-02 카네이션 확정상태', `
    SELECT ISNULL(p.CountryFlower, p.FlowerName) grp,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedRows,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedRows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02'
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY ISNULL(p.CountryFlower, p.FlowerName)`);

  await q('콜롬비아카네이션 33-01 마스터 isFix', `
    SELECT sm.isFix AS masterFix, COUNT(*) masters
      FROM ShipmentMaster sm
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-01' AND ISNULL(sm.isDeleted,0)=0
       AND EXISTS (
         SELECT 1 FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
          WHERE sd.ShipmentKey=sm.ShipmentKey AND p.CountryFlower=N'콜롬비아카네이션' AND ISNULL(sd.OutQuantity,0)>0
       )
     GROUP BY sm.isFix`);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
