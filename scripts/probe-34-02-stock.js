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

  await q('StockMaster 33-01~34-02', `
    SELECT StockKey, OrderYear, OrderWeek, isFix, CreateDtm
      FROM StockMaster
     WHERE OrderYear='2026' AND OrderWeek IN ('33-01','33-02','34-01','34-02')
     ORDER BY OrderWeek
  `);

  await q('ProductStock 음수 33-01~34-02', `
    SELECT sm.OrderWeek, ISNULL(p.CountryFlower,N'(없음)') grp, COUNT(*) negRows,
           CAST(SUM(ps.Stock) AS decimal(18,2)) negSum
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01','34-02')
       AND ISNULL(ps.Stock,0) < -0.001
     GROUP BY sm.OrderWeek, ISNULL(p.CountryFlower,N'(없음)')
     ORDER BY sm.OrderWeek, negRows DESC
  `);

  await q('주차별 확정', `
    SELECT sm.OrderWeek, p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-02','34-01','34-02')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, p.CountryFlower, isFix
  `);

  await q('34-02 입고', `
    SELECT ISNULL(p.CountryFlower,N'(없음)') grp, COUNT(*) rows,
           CAST(SUM(vw.OutQuantity) AS decimal(18,2)) qty
      FROM ViewWarehouse vw JOIN Product p ON p.ProdKey=vw.ProdKey
     WHERE vw.OrderYear='2026' AND vw.OrderWeek='34-02'
     GROUP BY ISNULL(p.CountryFlower,N'(없음)')
     ORDER BY qty DESC
  `);

  await q('34-02 leftover mismatch (snap vs prev+in-fixOut+adj)', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263402';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT TOP 30 p.ProdKey, p.ProdName, p.CountryFlower,
           CAST(ISNULL(prev.Stock,0) AS decimal(18,2)) prev,
           CAST(ISNULL(wr.qty,0) AS decimal(18,2)) inbound,
           CAST(ISNULL(outq.outFix,0) AS decimal(18,2)) outFix,
           CAST(ISNULL(outq.outAll,0) AS decimal(18,2)) outAll,
           CAST(ISNULL(adj.qty,0) AS decimal(18,2)) adj,
           CAST(ISNULL(snap.Stock,0) AS decimal(18,2)) snap,
           CAST(ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2) AS decimal(18,2)) leftover,
           CAST(ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2) AS decimal(18,2)) weekRemain,
           CAST(ISNULL(snap.Stock,0) - ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2) AS decimal(18,2)) snapMinusLeftover
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='34-02' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey,
               SUM(CASE WHEN vs.DetailFix=1 THEN vs.OutQuantity ELSE 0 END) outFix,
               SUM(vs.OutQuantity) outAll
          FROM ViewShipment vs WHERE vs.OrderYear='2026' AND vs.OrderWeek='34-02'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-02'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='34-02'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0
       AND (
         ABS(ISNULL(snap.Stock,0) - ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2)) > 0.02
         OR ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2) < -0.001
         OR ISNULL(snap.Stock,0) < -0.001
       )
     ORDER BY weekRemain, snapMinusLeftover
  `);

  await q('34-01 leftover mismatch count', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263401';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT
      SUM(CASE WHEN ABS(ISNULL(snap.Stock,0) - ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2)) > 0.02 THEN 1 ELSE 0 END) snapMismatch,
      SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2) < -0.001 THEN 1 ELSE 0 END) weekRemainNeg,
      SUM(CASE WHEN ISNULL(snap.Stock,0) < -0.001 THEN 1 ELSE 0 END) snapNeg,
      COUNT(*) rowsWithMove
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
               SUM(vs.OutQuantity) outAll
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
       AND (ISNULL(wr.qty,0)<>0 OR ISNULL(outq.outAll,0)<>0 OR ISNULL(snap.Stock,0)<>0 OR ISNULL(adj.qty,0)<>0)
  `);

  await q('34-02 leftover mismatch count', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263402';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT
      SUM(CASE WHEN ABS(ISNULL(snap.Stock,0) - ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outFix,0)+ISNULL(adj.qty,0),2)) > 0.02 THEN 1 ELSE 0 END) snapMismatch,
      SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0),2) < -0.001 THEN 1 ELSE 0 END) weekRemainNeg,
      SUM(CASE WHEN ISNULL(snap.Stock,0) < -0.001 THEN 1 ELSE 0 END) snapNeg,
      COUNT(*) rowsWithMove
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='34-02' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey,
               SUM(CASE WHEN vs.DetailFix=1 THEN vs.OutQuantity ELSE 0 END) outFix,
               SUM(vs.OutQuantity) outAll
          FROM ViewShipment vs WHERE vs.OrderYear='2026' AND vs.OrderWeek='34-02'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-02'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='34-02'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0
       AND (ISNULL(wr.qty,0)<>0 OR ISNULL(outq.outAll,0)<>0 OR ISNULL(snap.Stock,0)<>0 OR ISNULL(adj.qty,0)<>0)
  `);

  await q('Mondial/Freedom/Ruscus 체인', `
    SELECT p.ProdKey, p.ProdName, sm.OrderWeek,
           CAST(ps.Stock AS decimal(18,2)) snap,
           CAST(p.Stock AS decimal(18,2)) live
      FROM Product p
      CROSS JOIN StockMaster sm
      LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=p.ProdKey
     WHERE p.ProdKey IN (1426,1394,1717,1052)
       AND sm.OrderYear='2026' AND sm.OrderWeek IN ('33-02','34-01','34-02')
     ORDER BY p.ProdKey, sm.OrderWeek
  `);

  await q('34-02 화면식 Before+Ware-AllShip vs Stock', `
    DECLARE @cur nvarchar(20) = N'20263402';
    DECLARE @prev nvarchar(20);
    SELECT TOP 1 @prev = OrderYearWeek FROM StockMaster
     WHERE OrderYearWeek < @cur ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT TOP 20 p.ProdName, p.CountryFlower,
           CAST(ISNULL(bs.Stock,0) AS decimal(18,2)) BeforeStock,
           CAST(ISNULL(ns.Stock,0) AS decimal(18,2)) Stock,
           CAST(ISNULL(w.qty,0) AS decimal(18,2)) WareQuantity,
           CAST(ISNULL(s.qty,0) AS decimal(18,2)) ShipQuantity,
           CAST(ISNULL(bs.Stock,0)+ISNULL(w.qty,0)-ISNULL(s.qty,0)+ISNULL(adj.qty,0) AS decimal(18,2)) expectedIfAllShip,
           CAST(ISNULL(ns.Stock,0) - (ISNULL(bs.Stock,0)+ISNULL(w.qty,0)-ISNULL(s.qty,0)+ISNULL(adj.qty,0)) AS decimal(18,2)) diff
      FROM Product p
      JOIN ProductStock ns ON ns.ProdKey=p.ProdKey
      JOIN StockMaster smn ON smn.StockKey=ns.StockKey AND smn.OrderYearWeek=@cur
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYearWeek=@prev
      ) bs ON bs.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, SUM(OutQuantity) qty FROM ViewWarehouse WHERE OrderYearWeek2=@cur GROUP BY ProdKey
      ) w ON w.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, SUM(OutQuantity) qty FROM ViewShipment WHERE OrderYearWeek2=@cur GROUP BY ProdKey
      ) s ON s.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear=N'2026' AND sh.OrderWeek=N'34-02'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0
       AND ABS(ISNULL(ns.Stock,0) - (ISNULL(bs.Stock,0)+ISNULL(w.qty,0)-ISNULL(s.qty,0)+ISNULL(adj.qty,0))) > 0.02
     ORDER BY ABS(ISNULL(ns.Stock,0) - (ISNULL(bs.Stock,0)+ISNULL(w.qty,0)-ISNULL(s.qty,0)+ISNULL(adj.qty,0))) DESC
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
