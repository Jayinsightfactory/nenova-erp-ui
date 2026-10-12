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
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });
  const q = async (title, text) => {
    try {
      const r = await pool.request().query(text);
      console.log(`\n===== ${title} =====`);
      console.log(JSON.stringify(r.recordset, null, 2));
      return r.recordset;
    } catch (e) {
      console.log(`\n===== ${title} ERROR =====\n${e.message}`);
      return [];
    }
  };

  await q('StockMaster 33-02~34-02', `
    SELECT StockKey, OrderYear, OrderWeek, isFix, CreateDtm
      FROM StockMaster
     WHERE OrderYear='2026' AND OrderWeek IN ('33-02','34-01','34-02')
     ORDER BY OrderWeek
  `);

  await q('ProductStock 음수 33-02~34-02 품목군', `
    SELECT sm.OrderWeek, ISNULL(p.CountryFlower,N'(없음)') grp, COUNT(*) negRows,
           CAST(SUM(ps.Stock) AS decimal(18,2)) negSum
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-02','34-01','34-02')
       AND ISNULL(ps.Stock,0) < -0.001
     GROUP BY sm.OrderWeek, ISNULL(p.CountryFlower,N'(없음)')
     ORDER BY sm.OrderWeek, negRows DESC
  `);

  await q('34-01 leftover vs snapshot vs unfixedOut TOP 음수', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263401';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT TOP 40 p.ProdKey, p.ProdName, p.CountryFlower,
           CAST(ISNULL(prev.Stock,0) AS decimal(18,2)) prev,
           CAST(ISNULL(wr.qty,0) AS decimal(18,2)) inbound,
           CAST(ISNULL(outq.outFix,0) AS decimal(18,2)) outFix,
           CAST(ISNULL(outq.outUnfix,0) AS decimal(18,2)) outUnfix,
           CAST(ISNULL(snap.Stock,0) AS decimal(18,2)) snap,
           CAST(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0) AS decimal(18,2)) leftover,
           CAST(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)-ISNULL(outq.outUnfix,0)+ISNULL(adj.qty,0) AS decimal(18,2)) weekRemain,
           CAST(ISNULL(snap.Stock,0)-ISNULL(outq.outUnfix,0) AS decimal(18,2)) staleScreen
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='34-01' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey,
               SUM(CASE WHEN vs.DetailFix=1 THEN vs.OutQuantity ELSE 0 END) outFix,
               SUM(CASE WHEN ISNULL(vs.DetailFix,0)=0 THEN vs.OutQuantity ELSE 0 END) outUnfix
          FROM ViewShipment vs WHERE vs.OrderYear='2026' AND vs.OrderWeek='34-01'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='34-01'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0
       AND (
         ISNULL(snap.Stock,0) < -0.001
         OR ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)-ISNULL(outq.outUnfix,0)+ISNULL(adj.qty,0) < -0.001
         OR ISNULL(snap.Stock,0)-ISNULL(outq.outUnfix,0) < -0.49
       )
     ORDER BY staleScreen, weekRemain
  `);

  await q('34-01 확정상태 품목군', `
    SELECT p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           COUNT(DISTINCT sd.ProdKey) skus, CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY p.CountryFlower, isFix
  `);

  await q('34-02 확정상태 품목군', `
    SELECT p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-02' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY p.CountryFlower, isFix
  `);

  await q('StockHistory 18:20 이후', `
    SELECT CONVERT(varchar(16), ChangeDtm, 120) hhmm, ChangeID, ChangeType, Descr, OrderWeek, COUNT(*) cnt,
           CAST(SUM(AfterValue-BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory
     WHERE ChangeDtm >= '2026-08-21 18:00'
     GROUP BY CONVERT(varchar(16), ChangeDtm, 120), ChangeID, ChangeType, Descr, OrderWeek
     ORDER BY hhmm DESC
  `);

  await q('33-02 확정상태 요약', `
    SELECT p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows, CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY p.CountryFlower, isFix
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
