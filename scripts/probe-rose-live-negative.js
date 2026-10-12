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

  await q('Mondial White 1426 오늘 이력', `
    SELECT ChangeDtm, ChangeID, ChangeType, OrderYear, OrderWeek, BeforeValue, AfterValue, Descr
      FROM StockHistory
     WHERE ProdKey=1426 AND ChangeDtm >= '2026-08-20'
     ORDER BY ChangeDtm DESC
  `);

  await q('Mondial White 주차별 입고/출고/스냅샷/확정', `
    SELECT smw.OrderWeek,
           CAST(ISNULL(wr.qty,0) AS decimal(18,2)) warehouse,
           CAST(ISNULL(sh.outAll,0) AS decimal(18,2)) outAll,
           CAST(ISNULL(sh.outFix,0) AS decimal(18,2)) outFix,
           CAST(ISNULL(sh.outUnfix,0) AS decimal(18,2)) outUnfix,
           CAST(ps.Stock AS decimal(18,2)) snapshot,
           CAST(p.Stock AS decimal(18,2)) live
      FROM (SELECT DISTINCT OrderWeek FROM StockMaster WHERE OrderYear='2026' AND OrderWeek IN ('32-02','33-01','33-02','34-01','34-02')) smw
      CROSS JOIN Product p
      LEFT JOIN StockMaster sm ON sm.OrderYear='2026' AND sm.OrderWeek=smw.OrderWeek
      LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=1426
      LEFT JOIN (
        SELECT wm.OrderWeek, SUM(wd.OutQuantity) qty
          FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
         WHERE wd.ProdKey=1426 AND wm.OrderYear='2026' AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wd.isDeleted,0)=0
         GROUP BY wm.OrderWeek
      ) wr ON wr.OrderWeek=smw.OrderWeek
      LEFT JOIN (
        SELECT sm.OrderWeek,
               SUM(sd.OutQuantity) outAll,
               SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN sd.OutQuantity ELSE 0 END) outFix,
               SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN sd.OutQuantity ELSE 0 END) outUnfix
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=1426 AND sm.OrderYear='2026'
         GROUP BY sm.OrderWeek
      ) sh ON sh.OrderWeek=smw.OrderWeek
     WHERE p.ProdKey=1426
     ORDER BY smw.OrderWeek
  `);

  await q('콜롬비아장미 주차별 확정', `
    SELECT sm.OrderWeek, ISNULL(sd.isFix,0) isFix, COUNT(DISTINCT sd.ProdKey) skus, COUNT(*) rows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('32-02','33-01','33-02','34-01')
       AND p.CountryFlower=N'콜롬비아장미' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, isFix
  `);

  await q('음수 live 장미 33-01 leftover vs live vs out', `
    DECLARE @OrderYearWeek nvarchar(20) = N'20263301';
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT p.ProdKey, p.ProdName, CAST(p.Stock AS decimal(18,2)) live,
           CAST(ISNULL(prev.Stock,0) AS decimal(18,2)) prev,
           CAST(ISNULL(wr.qty,0) AS decimal(18,2)) inbound,
           CAST(ISNULL(outq.outAll,0) AS decimal(18,2)) outAll,
           CAST(ISNULL(outq.outFix,0) AS decimal(18,2)) outFix,
           CAST(ISNULL(snap.Stock,0) AS decimal(18,2)) snap3301,
           CAST(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(outq.outAll,0)+ISNULL(adj.qty,0) AS decimal(18,2)) weekRemain
      FROM Product p
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.StockKey=@BeforeStockKey
      ) prev ON prev.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse
         WHERE OrderYear='2026' AND OrderWeek='33-01' GROUP BY ProdKey
      ) wr ON wr.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT vs.ProdKey, SUM(vs.OutQuantity) outAll,
               SUM(CASE WHEN vs.DetailFix=1 THEN vs.OutQuantity ELSE 0 END) outFix
          FROM ViewShipment vs WHERE vs.OrderYear='2026' AND vs.OrderWeek='33-01'
         GROUP BY vs.ProdKey
      ) outq ON outq.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey
         WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-01'
      ) snap ON snap.ProdKey=p.ProdKey
      LEFT JOIN (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty
          FROM StockHistory sh
          JOIN CodeInfo ci ON ci.Category='StockType' AND sh.ChangeType=ci.Descr
         WHERE sh.OrderYear='2026' AND sh.OrderWeek='33-01'
         GROUP BY sh.ProdKey
      ) adj ON adj.ProdKey=p.ProdKey
     WHERE ISNULL(p.isDeleted,0)=0 AND p.CountryFlower=N'콜롬비아장미' AND p.Stock < 0
     ORDER BY p.Stock
  `);

  await q('16:49 34-01 확정 8건이 무슨 품목', `
    SELECT p.CountryFlower, p.ProdName, sh.ProdKey, sh.BeforeValue, sh.AfterValue, sh.OrderWeek
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-21 16:49' AND sh.ChangeDtm < '2026-08-21 16:50'
       AND sh.Descr=N'출고확정'
     ORDER BY p.CountryFlower, p.ProdName
  `);

  await q('16:42 33-01 확정 품목군', `
    SELECT p.CountryFlower, COUNT(*) cnt, CAST(SUM(sh.AfterValue-sh.BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-21 16:42' AND sh.ChangeDtm < '2026-08-21 16:43'
       AND sh.Descr=N'출고확정' AND sh.OrderWeek='33-01'
     GROUP BY p.CountryFlower
     ORDER BY cnt DESC
  `);

  await q('32-02 콜롬비아장미 확정여부', `
    SELECT ISNULL(sd.isFix,0) isFix, COUNT(*) rows, CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='32-02'
       AND p.CountryFlower=N'콜롬비아장미' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY ISNULL(sd.isFix,0)
  `);

  await q('입고삭제 16:36 품목군', `
    SELECT TOP 20 p.CountryFlower, COUNT(*) cnt, CAST(SUM(sh.AfterValue-sh.BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory sh
      LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-21 16:36' AND sh.ChangeDtm < '2026-08-21 16:37'
       AND sh.Descr=N'입고 삭제'
     GROUP BY p.CountryFlower
     ORDER BY cnt DESC
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
