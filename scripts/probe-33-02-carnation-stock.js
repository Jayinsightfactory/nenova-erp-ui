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
    const r = await pool.request().query(text);
    console.log(`\n===== ${title} =====`);
    console.log(JSON.stringify(r.recordset, null, 2));
    return r.recordset;
  };

  await q('카네이션 주차별 확정', `
    SELECT sm.OrderWeek, ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           COUNT(DISTINCT sd.ProdKey) skus,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('32-02','33-01','33-02','34-01','34-02')
       AND p.CountryFlower=N'콜롬비아카네이션' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, isFix
  `);

  await q('33-02 카네이션 leftover vs snap vs screen', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263302';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT p.ProdKey, p.ProdName,
           CAST(ISNULL(prev.Stock,0) AS decimal(18,2)) prev,
           CAST(ISNULL(wr.qty,0) AS decimal(18,2)) inbound,
           CAST(ISNULL(outq.outFix,0) AS decimal(18,2)) outFix,
           CAST(ISNULL(outq.outUnfix,0) AS decimal(18,2)) outUnfix,
           CAST(ISNULL(snap.Stock,0) AS decimal(18,2)) snap,
           CAST(p.Stock AS decimal(18,2)) live,
           CAST(ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2) AS decimal(18,2)) leftover,
           CAST(ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)-ISNULL(outq.outUnfix,0)+ISNULL(adj.qty,0),2) AS decimal(18,2)) weekRemain,
           CAST(ISNULL(snap.Stock,0)-ISNULL(outq.outUnfix,0) AS decimal(18,2)) staleScreen
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='33-02' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey,
               SUM(CASE WHEN vs.DetailFix=1 THEN vs.OutQuantity ELSE 0 END) outFix,
               SUM(CASE WHEN ISNULL(vs.DetailFix,0)=0 THEN vs.OutQuantity ELSE 0 END) outUnfix
          FROM ViewShipment vs
         WHERE vs.OrderYear='2026' AND vs.OrderWeek='33-02'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='33-02'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0 AND p.CountryFlower=N'콜롬비아카네이션'
       AND (ISNULL(wr.qty,0)<>0 OR ISNULL(outq.outFix,0)<>0 OR ISNULL(outq.outUnfix,0)<>0
            OR ISNULL(snap.Stock,0)<>0 OR p.Stock<0)
     ORDER BY staleScreen, weekRemain, p.ProdName
  `);

  await q('33-02 카네이션 합계', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263302';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT COUNT(*) skus,
           SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2)< -0.001 THEN 1 ELSE 0 END) weekRemainNeg,
           SUM(CASE WHEN ISNULL(snap.Stock,0) < -0.001 THEN 1 ELSE 0 END) snapNeg,
           SUM(CASE WHEN ISNULL(snap.Stock,0)-ISNULL(outq.outUnfix,0) < -0.49 THEN 1 ELSE 0 END) staleScreenNeg,
           CAST(SUM(ISNULL(wr.qty,0)) AS decimal(18,2)) inbound,
           CAST(SUM(ISNULL(outq.outAll,0)) AS decimal(18,2)) outAll,
           CAST(SUM(ISNULL(outq.outUnfix,0)) AS decimal(18,2)) outUnfix,
           CAST(SUM(ISNULL(snap.Stock,0)) AS decimal(18,2)) snapSum,
           CAST(SUM(ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2)) AS decimal(18,2)) weekRemainSum
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='33-02' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey, SUM(vs.OutQuantity) outAll,
               SUM(CASE WHEN ISNULL(vs.DetailFix,0)=0 THEN vs.OutQuantity ELSE 0 END) outUnfix
          FROM ViewShipment vs
         WHERE vs.OrderYear='2026' AND vs.OrderWeek='33-02'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='33-02'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0 AND p.CountryFlower=N'콜롬비아카네이션'
       AND (ISNULL(wr.qty,0)<>0 OR ISNULL(outq.outAll,0)<>0 OR ISNULL(snap.Stock,0)<>0)
  `);

  await q('33-02 카네이션 StockHistory 8/20 이후', `
    SELECT CONVERT(varchar(16), sh.ChangeDtm, 120) hhmm, sh.ChangeID, sh.ChangeType, sh.Descr,
           sh.OrderWeek, COUNT(*) cnt,
           CAST(SUM(sh.AfterValue-sh.BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE p.CountryFlower=N'콜롬비아카네이션'
       AND sh.ChangeDtm >= '2026-08-20'
       AND sh.OrderWeek IN ('33-01','33-02','34-01')
     GROUP BY CONVERT(varchar(16), sh.ChangeDtm, 120), sh.ChangeID, sh.ChangeType, sh.Descr, sh.OrderWeek
     ORDER BY hhmm DESC
  `);

  await q('Zurigo/Scarlete 33-02', `
    SELECT p.ProdKey, p.ProdName, sm.OrderWeek,
           CAST(ps.Stock AS decimal(18,2)) snap, CAST(p.Stock AS decimal(18,2)) live
      FROM Product p
      CROSS JOIN StockMaster sm
      LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=p.ProdKey
     WHERE p.ProdKey IN (504,1052) AND sm.OrderYear='2026'
       AND sm.OrderWeek IN ('32-02','33-01','33-02','34-01','34-02')
     ORDER BY p.ProdKey, sm.OrderWeek
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
