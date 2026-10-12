#!/usr/bin/env node
/** Read-only: why 2026 33-01 carnations went negative. */
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

const YEAR = '2026';
const WEEK = '33-01';
const PREV = '32-02';
const FLOWER = '%카네이션%';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

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
      return r.recordset;
    } catch (err) {
      console.log(`\n===== ${title} ERROR =====`);
      console.log(err.message);
      return [];
    }
  };

  await q('StockMaster 33-01 / 32-02', `
    SELECT sm.StockKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.isFix
      FROM StockMaster sm
     WHERE sm.OrderYear=@yr AND sm.OrderWeek IN (@wk, @prev)
     ORDER BY sm.OrderWeek, sm.StockKey`, { yr: YEAR, wk: WEEK, prev: PREV });

  await q('카네이션 33-01 스냅샷 부호 집계', `
    SELECT
      COUNT(*) AS snapshotRows,
      SUM(CASE WHEN ISNULL(ps.Stock,0) < 0 THEN 1 ELSE 0 END) AS negPs,
      SUM(CASE WHEN ISNULL(ps.Stock,0) = 0 THEN 1 ELSE 0 END) AS zeroPs,
      SUM(CASE WHEN ISNULL(ps.Stock,0) > 0 THEN 1 ELSE 0 END) AS posPs,
      SUM(CASE WHEN ISNULL(p.Stock,0) < 0 THEN 1 ELSE 0 END) AS negLive,
      MIN(ps.Stock) AS minPs, MAX(ps.Stock) AS maxPs,
      SUM(ps.Stock) AS sumPs
    FROM ProductStock ps
    JOIN StockMaster sm ON sm.StockKey=ps.StockKey
    JOIN Product p ON p.ProdKey=ps.ProdKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
      AND ISNULL(p.isDeleted,0)=0
      AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')`,
  { yr: YEAR, wk: WEEK, f: FLOWER });

  await q('카네이션 국가별 33-01 음수', `
    SELECT ISNULL(p.CountryFlower, p.CounName) AS grp,
           COUNT(*) cnt,
           SUM(CASE WHEN ISNULL(ps.Stock,0)<0 THEN 1 ELSE 0 END) negPs,
           SUM(CASE WHEN ISNULL(p.Stock,0)<0 THEN 1 ELSE 0 END) negLive,
           SUM(ISNULL(ps.Stock,0)) sumPs
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
       AND ISNULL(p.isDeleted,0)=0
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY ISNULL(p.CountryFlower, p.CounName)
     ORDER BY negPs DESC, cnt DESC`,
  { yr: YEAR, wk: WEEK, f: FLOWER });

  await q('33-01 카네이션 잔량 분해(음수 상위 40)', `
    SELECT TOP 40
      p.ProdKey, p.ProdName, p.CountryFlower, p.OutUnit, p.BunchOf1Box, p.SteamOf1Box,
      ISNULL(p.Stock,0) AS live,
      ISNULL(ps.Stock,0) AS ps33,
      ISNULL(prev.Stock,0) AS ps32,
      ISNULL(inc.inQty,0) AS inQty,
      ISNULL(adj.adjQty,0) AS adjQty,
      ISNULL(outFix.outQty,0) AS outFix,
      ISNULL(outAll.outQty,0) AS outAll,
      ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) AS remainAll,
      ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outFix.outQty,0) AS remainFix
    FROM Product p
    OUTER APPLY (
      SELECT TOP 1 ps.Stock FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
    ) ps
    OUTER APPLY (
      SELECT TOP 1 ps.Stock FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@prev
        AND (sm.isFix IS NULL OR sm.isFix=1)
      ORDER BY sm.StockKey DESC
    ) prev
    OUTER APPLY (
      SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty
        FROM WarehouseDetail wd
        JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
       WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk
    ) inc
    OUTER APPLY (
      SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty
        FROM StockHistory sh
       WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
    ) adj
    OUTER APPLY (
      SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
       WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sd.isFix,0)=1
    ) outFix
    OUTER APPLY (
      SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
       WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
    ) outAll
    WHERE ISNULL(p.isDeleted,0)=0
      AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
      AND (ISNULL(ps.Stock,0) < 0 OR ISNULL(p.Stock,0) < 0
           OR ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) < 0)
    ORDER BY ISNULL(ps.Stock,0) ASC, remainAll ASC`,
  { yr: YEAR, wk: WEEK, prev: PREV, f: FLOWER });

  await q('원인 패턴 집계(음수 후보)', `
    SELECT
      SUM(CASE WHEN ISNULL(ps.Stock,0)<0 THEN 1 ELSE 0 END) AS negSnapshot,
      SUM(CASE WHEN ISNULL(inc.inQty,0)=0 AND ISNULL(outAll.outQty,0)>0 THEN 1 ELSE 0 END) AS noInHasOut,
      SUM(CASE WHEN ISNULL(outAll.outQty,0) > 8 * NULLIF(ISNULL(inc.inQty,0)+ISNULL(prev.Stock,0),0)
                AND ISNULL(outAll.outQty,0)>0 THEN 1 ELSE 0 END) AS outLooks10x,
      SUM(CASE WHEN ISNULL(prev.Stock,0)<0 THEN 1 ELSE 0 END) AS prevNeg,
      SUM(CASE WHEN ISNULL(prev.Stock,0)=0 AND ISNULL(inc.inQty,0)=0 THEN 1 ELSE 0 END) AS noPrevNoIn,
      SUM(CASE WHEN ABS(ISNULL(ps.Stock,0) - (ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outFix.outQty,0))) >= 0.5 THEN 1 ELSE 0 END) AS staleVsFix,
      AVG(CASE WHEN ISNULL(inc.inQty,0)>0 THEN ISNULL(outAll.outQty,0)/NULLIF(inc.inQty,0) END) AS avgOutOverIn
    FROM Product p
    OUTER APPLY (
      SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) ps
    OUTER APPLY (
      SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@prev AND (sm.isFix IS NULL OR sm.isFix=1)
      ORDER BY sm.StockKey DESC) prev
    OUTER APPLY (
      SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd
      JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
      WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk) inc
    OUTER APPLY (
      SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
      WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj
    OUTER APPLY (
      SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sd.isFix,0)=1) outFix
    OUTER APPLY (
      SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) outAll
    WHERE ISNULL(p.isDeleted,0)=0
      AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
      AND ISNULL(ps.Stock,0) < 0`,
  { yr: YEAR, wk: WEEK, prev: PREV, f: FLOWER });

  await q('33-01/32-02 카네이션 최근 StockHistory', `
    SELECT TOP 80 sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.OrderWeek, sh.ProdKey,
           p.ProdName, sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS delta,
           LEFT(ISNULL(sh.Descr,N''), 80) AS Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek IN (@wk, @prev)
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     ORDER BY sh.ChangeDtm DESC`,
  { yr: YEAR, wk: WEEK, prev: PREV, f: FLOWER });

  await q('33-01 카네이션 최근 ShipmentHistory', `
    SELECT TOP 40 sh.ChangeDtm, sh.ChangeID, sh.ChangeType, p.ProdName, c.CustName,
           sh.BeforeValue, sh.AfterValue, LEFT(ISNULL(sh.Descr,N''), 80) AS Descr
      FROM ShipmentHistory sh
      JOIN ShipmentDetail sd ON sh.SdetailKey=sd.SdetailKey
      JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
      JOIN Product p ON p.ProdKey=sd.ProdKey
      LEFT JOIN Customer c ON sm.CustKey=c.CustKey
     WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     ORDER BY sh.ChangeDtm DESC`,
  { yr: YEAR, wk: WEEK, f: FLOWER });

  await q('33-01 카네이션 입고 Master', `
    SELECT wm.WarehouseKey, wm.OrderWeek, wm.isDeleted, wm.InputDate, wm.CreateDtm, wm.CreateID, wm.FarmName, wm.FileName,
           COUNT(wd.WdetailKey) details, SUM(ISNULL(wd.OutQuantity,0)) qty
      FROM WarehouseMaster wm
      JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      JOIN Product p ON p.ProdKey=wd.ProdKey
     WHERE wm.OrderYear=@yr AND wm.OrderWeek=@wk
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY wm.WarehouseKey, wm.OrderWeek, wm.isDeleted, wm.InputDate, wm.CreateDtm, wm.CreateID, wm.FarmName, wm.FileName
     ORDER BY wm.CreateDtm DESC`,
  { yr: YEAR, wk: WEEK, f: FLOWER });

  await q('33-01 카네이션 출고 확정상태', `
    SELECT ISNULL(p.CountryFlower, p.FlowerName) grp,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedRows,
           SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedRows,
           SUM(ISNULL(sd.OutQuantity,0)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY ISNULL(p.CountryFlower, p.FlowerName)
     ORDER BY outQty DESC`,
  { yr: YEAR, wk: WEEK, f: FLOWER });

  await q('33-01 출고있는 카네이션 잔량 부호', `
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
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) ps
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@prev) prev
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk) inc
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) outAll
      WHERE ISNULL(p.isDeleted,0)=0
        AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
        AND ISNULL(outAll.outQty,0) > 0
    ) x`,
  { yr: YEAR, wk: WEEK, prev: PREV, f: FLOWER });

  await q('33-01 잔량마이너스 품목 전체', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, p.OutUnit,
           ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps33, ISNULL(prev.Stock,0) ps32,
           ISNULL(inc.inQty,0) inQty, ISNULL(adj.adjQty,0) adjQty,
           ISNULL(outAll.outQty,0) outAll, ISNULL(outFix.outQty,0) outFix,
           ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) remainAll
    FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) ps
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@prev) prev
    OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk) inc
    OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk) outAll
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sd.isFix,0)=1) outFix
    WHERE ISNULL(p.isDeleted,0)=0
      AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
      AND ISNULL(outAll.outQty,0) > 0
      AND ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)+ISNULL(adj.adjQty,0)-ISNULL(outAll.outQty,0) < -0.001
    ORDER BY remainAll`,
  { yr: YEAR, wk: WEEK, prev: PREV, f: FLOWER });

  await q('오늘 카네이션 StockHistory 유형별', `
    SELECT sh.Descr, sh.ChangeType, sh.OrderWeek, COUNT(*) cnt,
           MIN(sh.ChangeDtm) minDtm, MAX(sh.ChangeDtm) maxDtm, MAX(sh.ChangeID) uid
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-20'
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY sh.Descr, sh.ChangeType, sh.OrderWeek
     ORDER BY maxDtm DESC`,
  { f: FLOWER });

  await q('카네이션 ProductStock 주차별 합', `
    SELECT sm.OrderWeek, COUNT(*) rows,
           SUM(CASE WHEN ISNULL(ps.Stock,0)<0 THEN 1 ELSE 0 END) neg,
           SUM(CASE WHEN ISNULL(ps.Stock,0)>0 THEN 1 ELSE 0 END) pos,
           SUM(ISNULL(ps.Stock,0)) sumPs
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('31-01','31-02','32-01','32-02','33-01','33-02')
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')
     GROUP BY sm.OrderWeek
     ORDER BY sm.OrderWeek`,
  { f: FLOWER });

  await q('Doncel/MoonLight/Zurigo 분해', `
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live,
           ISNULL(ps33.Stock,0) ps33, ISNULL(ps32.Stock,0) ps32, ISNULL(ps32b.Stock,0) ps3201,
           ISNULL(inc.inQty,0) in33, ISNULL(outAll.outQty,0) out33, ISNULL(sdFix.fixedCnt,0) fixedCnt, ISNULL(sdFix.unfixedCnt,0) unfixedCnt
    FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') ps33
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-02') ps32
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-01') ps32b
    OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek='33-01') inc
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01') outAll
    OUTER APPLY (SELECT SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedCnt, SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedCnt FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01' AND ISNULL(sd.OutQuantity,0)>0) sdFix
    WHERE p.ProdKey IN (389, 447, 504, 1052)
  `);

  await q('32-02 카네이션 스냅샷 부호', `
    SELECT COUNT(*) snapshotRows,
           SUM(CASE WHEN ISNULL(ps.Stock,0)<0 THEN 1 ELSE 0 END) negPs,
           SUM(CASE WHEN ISNULL(ps.Stock,0)>0 THEN 1 ELSE 0 END) posPs,
           SUM(ps.Stock) sumPs
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE sm.OrderYear=@yr AND sm.OrderWeek=@prev
       AND (p.FlowerName LIKE @f OR p.CountryFlower LIKE @f OR p.ProdName LIKE N'%CARNATION%')`,
  { yr: YEAR, prev: PREV, f: FLOWER });

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
