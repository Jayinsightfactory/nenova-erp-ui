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
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;
const FLOWER = '%카네이션%';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });
  const q = async (title, text, inputs = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(inputs)) req.input(k, v);
    try {
      const r = await req.query(text);
      console.log(`\n===== ${title} =====`);
      console.log(JSON.stringify(r.recordset, null, 2));
    } catch (err) {
      console.log(`\n===== ${title} ERROR =====\n${err.message}`);
    }
  };

  await q('출고 확정상태', `
    SELECT ISNULL(p.CountryFlower, p.FlowerName) grp,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedRows,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedRows,
           SUM(ISNULL(sd.OutQuantity,0)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-01'
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY ISNULL(p.CountryFlower, p.FlowerName)
     ORDER BY outQty DESC`, { f: FLOWER });

  await q('출고있는 카네이션 잔량 부호', `
    SELECT
      COUNT(*) shippedSkus,
      SUM(CASE WHEN remainAll < -0.001 THEN 1 ELSE 0 END) negRemain,
      SUM(CASE WHEN remainAll >= -0.001 AND remainAll < 0.001 THEN 1 ELSE 0 END) zeroRemain,
      SUM(CASE WHEN remainAll > 0.001 THEN 1 ELSE 0 END) posRemain,
      SUM(inQty) sumIn, SUM(outAll) sumOut, SUM(ps32) sumPrev, SUM(ps33) sumPs33
    FROM (
      SELECT
        ISNULL(prev.Stock,0) AS ps32,
        ISNULL(ps.Stock,0) AS ps33,
        ISNULL(inc.inQty,0) AS inQty,
        ISNULL(outAll.outQty,0) AS outAll,
        ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) AS remainAll
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') ps
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-02') prev
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek='33-01') inc
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear='2026' AND sh.OrderWeek='33-01' AND ${MANUAL}) adj
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') outAll
      WHERE ISNULL(p.isDeleted,0)=0
        AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
        AND ISNULL(outAll.outQty,0) > 0
    ) x`, { f: FLOWER });

  await q('잔량마이너스 품목', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, p.OutUnit, p.BunchOf1Box,
           ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps33, ISNULL(prev.Stock,0) ps32,
           ISNULL(inc.inQty,0) inQty, ISNULL(adj.adjQty,0) adjQty, ISNULL(outAll.outQty,0) outAll,
           ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) remainAll
    FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') ps
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-02') prev
    OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek='33-01') inc
    OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear='2026' AND sh.OrderWeek='33-01' AND ${MANUAL}) adj
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') outAll
    WHERE ISNULL(p.isDeleted,0)=0
      AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
      AND ISNULL(outAll.outQty,0) > 0
      AND ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) < -0.001
    ORDER BY remainAll`, { f: FLOWER });

  await q('오늘 카네이션 StockHistory 유형별', `
    SELECT sh.Descr, sh.ChangeType, sh.OrderWeek, COUNT(*) cnt,
           MIN(sh.ChangeDtm) minDtm, MAX(sh.ChangeDtm) maxDtm, MAX(sh.ChangeID) uid
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-20'
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY sh.Descr, sh.ChangeType, sh.OrderWeek
     ORDER BY maxDtm DESC`, { f: FLOWER });

  await q('카네이션 ProductStock 주차별 합', `
    SELECT sm.OrderWeek, COUNT(*) rows,
           SUM(CASE WHEN ISNULL(ps.Stock,0)<0 THEN 1 ELSE 0 END) neg,
           SUM(CASE WHEN ISNULL(ps.Stock,0)>0 THEN 1 ELSE 0 END) pos,
           CAST(SUM(ISNULL(ps.Stock,0)) AS decimal(18,2)) sumPs
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('31-01','31-02','32-01','32-02','33-01','33-02')
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY sm.OrderWeek
     ORDER BY sm.OrderWeek`, { f: FLOWER });

  await q('대표품목 분해', `
    SELECT p.ProdKey, p.ProdName, CAST(ISNULL(p.Stock,0) AS decimal(18,4)) live,
           CAST(ISNULL(ps33.Stock,0) AS decimal(18,4)) ps33,
           CAST(ISNULL(ps32.Stock,0) AS decimal(18,4)) ps3202,
           CAST(ISNULL(ps32b.Stock,0) AS decimal(18,4)) ps3201,
           CAST(ISNULL(inc.inQty,0) AS decimal(18,4)) in33,
           CAST(ISNULL(outAll.outQty,0) AS decimal(18,4)) out33,
           ISNULL(sdFix.fixedCnt,0) fixedCnt, ISNULL(sdFix.unfixedCnt,0) unfixedCnt
    FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') ps33
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-02') ps32
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-01') ps32b
    OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek='33-01') inc
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') outAll
    OUTER APPLY (SELECT SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCnt, SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedCnt FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01' AND ISNULL(sd.OutQuantity,0)>0) sdFix
    WHERE p.ProdKey IN (389, 447, 504, 1052)`);

  await q('32-02 이후 카네이션 재고조정', `
    SELECT TOP 30 sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.OrderWeek, p.ProdName,
           CAST(sh.BeforeValue AS decimal(18,3)) beforeV, CAST(sh.AfterValue AS decimal(18,3)) afterV,
           CAST(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS decimal(18,3)) delta,
           LEFT(ISNULL(sh.Descr,N''), 90) Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear='2026' AND sh.OrderWeek IN ('32-01','32-02','33-01')
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f)
       AND ${MANUAL}
     ORDER BY sh.ChangeDtm DESC`, { f: FLOWER });

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
