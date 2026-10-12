#!/usr/bin/env node
/** Why 33-01 carnations look like 10+ negatives on screen after unfix. */
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
    const r = await pool.request().query(text);
    console.log(`\n===== ${title} (${r.recordset.length}) =====`);
    console.log(JSON.stringify(r.recordset, null, 2));
    return r.recordset;
  };

  await q('A. 전산확정 공식: 현재 ProductStock - ViewShipment (ROUND 0)', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower,
           CAST(ISNULL(ps.Stock,0) AS decimal(18,4)) ps33,
           CAST(ISNULL(vs.outQty,0) AS decimal(18,4)) viewOut,
           CAST(ROUND(ISNULL(ps.Stock,0) - ISNULL(vs.outQty,0), 0) AS int) exeRemain
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 x.Stock FROM ProductStock x
        JOIN StockMaster sm ON sm.StockKey=x.StockKey
        WHERE x.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01'
      ) ps
      OUTER APPLY (
        SELECT SUM(v.OutQuantity) outQty FROM ViewShipment v
        WHERE v.ProdKey=p.ProdKey AND v.OrderYear='2026' AND v.OrderWeek='33-01'
      ) vs
     WHERE p.isDeleted=0
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%' OR p.ProdName LIKE N'%CARNATION%')
       AND ISNULL(vs.outQty,0) > 0
       AND ROUND(ISNULL(ps.Stock,0) - ISNULL(vs.outQty,0), 0) < 0
     ORDER BY exeRemain, p.ProdName`);

  await q('A집계', `
    SELECT COUNT(*) negCnt
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 x.Stock FROM ProductStock x
        JOIN StockMaster sm ON sm.StockKey=x.StockKey
        WHERE x.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01'
      ) ps
      OUTER APPLY (
        SELECT SUM(v.OutQuantity) outQty FROM ViewShipment v
        WHERE v.ProdKey=p.ProdKey AND v.OrderYear='2026' AND v.OrderWeek='33-01'
      ) vs
     WHERE p.isDeleted=0
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%' OR p.ProdName LIKE N'%CARNATION%')
       AND ISNULL(vs.outQty,0) > 0
       AND ROUND(ISNULL(ps.Stock,0) - ISNULL(vs.outQty,0), 0) < 0`);

  await q('B. 웹 가드: 전차수+ViewWarehouse+StockType조정-ViewShipment', `
    DECLARE @yr NVARCHAR(4)='2026', @wk NVARCHAR(10)='33-01', @ywk NVARCHAR(20)='20263301';
    WITH incoming AS (
      SELECT ProdKey, SUM(OutQuantity) qty FROM ViewWarehouse
       WHERE OrderYear=@yr AND OrderWeek=@wk GROUP BY ProdKey
    ), outgoing AS (
      SELECT ProdKey, SUM(OutQuantity) qty FROM ViewShipment
       WHERE OrderYear=@yr AND OrderWeek=@wk GROUP BY ProdKey
    ), adjustment AS (
      SELECT sh.ProdKey, SUM(sh.AfterValue - sh.BeforeValue) qty
        FROM StockHistory sh
        JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
       WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk GROUP BY sh.ProdKey
    )
    SELECT p.ProdKey, p.ProdName, p.CountryFlower,
           CAST(ISNULL(prev.Stock,0) AS decimal(18,4)) prevStock,
           CAST(ISNULL(i.qty,0) AS decimal(18,4)) inQty,
           CAST(ISNULL(a.qty,0) AS decimal(18,4)) adjQty,
           CAST(ISNULL(o.qty,0) AS decimal(18,4)) outQty,
           CAST(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0) AS decimal(18,4)) remain
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM StockMaster sm
        JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=p.ProdKey
        WHERE sm.OrderYear=@yr
          AND CAST(sm.OrderYear AS NVARCHAR(4)) + REPLACE(sm.OrderWeek,'-','') < @ywk
        ORDER BY sm.OrderYearWeek DESC, sm.StockKey DESC
      ) prev
      LEFT JOIN incoming i ON i.ProdKey=p.ProdKey
      LEFT JOIN outgoing o ON o.ProdKey=p.ProdKey
      LEFT JOIN adjustment a ON a.ProdKey=p.ProdKey
     WHERE p.isDeleted=0
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%' OR p.ProdName LIKE N'%CARNATION%')
       AND (i.ProdKey IS NOT NULL OR o.ProdKey IS NOT NULL OR ISNULL(prev.Stock,0)<0)
       AND ROUND(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0),2) < 0
     ORDER BY remain, p.ProdName`);

  await q('C. 재고화면 빨간글씨: ProductStock<=0 이면서 출고있음', `
    SELECT COUNT(*) cntZeroOrNegWithOut,
           SUM(CASE WHEN ISNULL(ps.Stock,0) < 0 THEN 1 ELSE 0 END) negPs,
           SUM(CASE WHEN ISNULL(ps.Stock,0) = 0 THEN 1 ELSE 0 END) zeroPs
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 x.Stock FROM ProductStock x JOIN StockMaster sm ON sm.StockKey=x.StockKey
        WHERE x.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01'
      ) ps
      OUTER APPLY (
        SELECT SUM(sd.OutQuantity) outQty FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
        WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01'
      ) o
     WHERE p.isDeleted=0
       AND (p.FlowerName LIKE N'%카네이션%' OR p.CountryFlower LIKE N'%카네이션%' OR p.ProdName LIKE N'%CARNATION%')
       AND ISNULL(o.outQty,0) > 0
       AND ISNULL(ps.Stock,0) <= 0`);

  await q('StockType 코드', `
    SELECT Descr FROM CodeInfo WHERE Category=N'StockType' ORDER BY Descr`);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
