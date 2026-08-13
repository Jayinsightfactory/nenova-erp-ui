#!/usr/bin/env node
/**
 * Nenova stock ledger full-year audit (read-only).
 *
 * Invariants:
 * - ProductStock = previous EXE snapshot + ViewWarehouse - fixed ViewShipment + StockType history
 * - The FormStockView screen equation uses all shipment rows, so it is only required to match
 *   once a week has no positive unfixed shipment details.
 * - StockMaster.isFix is diagnostic only; it is not used to select ProductStock snapshots.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const sql = require('mssql');

const year = String(process.argv.find((arg) => arg.startsWith('--year='))?.split('=')[1] || '2026');
const tolerance = Number(process.argv.find((arg) => arg.startsWith('--tolerance='))?.split('=')[1] || '0.011');

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 30000,
    requestTimeout: 600000,
  },
});

async function select(statement) {
  const result = await pool.request().input('yr', sql.NVarChar, year).query(statement);
  return result.recordset;
}

const masterRows = await select(`
  WITH master_rows AS (
    SELECT sm.StockKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.isFix,
           COUNT(*) OVER (PARTITION BY sm.OrderYear, sm.OrderWeek) masterCount,
           ROW_NUMBER() OVER (PARTITION BY sm.OrderYear, sm.OrderWeek ORDER BY sm.StockKey DESC) rn
      FROM StockMaster sm
     WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr
  )
  SELECT m.OrderWeek, m.StockKey, m.OrderYearWeek, m.isFix, m.masterCount,
         COUNT(ps.ProdKey) snapshotCount,
         SUM(CASE WHEN ps.Stock < -0.0005 THEN 1 ELSE 0 END) negativeCount,
         SUM(CASE WHEN ps.Stock IS NULL THEN 1 ELSE 0 END) nullStockCount,
         CASE WHEN REPLACE(ISNULL(m.OrderYearWeek,''),'-','')=
                        CAST(m.OrderYear AS NVARCHAR(4))+REPLACE(m.OrderWeek,'-','')
              THEN 0 ELSE 1 END orderYearWeekMismatch
    FROM master_rows m
    LEFT JOIN ProductStock ps ON ps.StockKey=m.StockKey
   WHERE m.rn=1
   GROUP BY m.OrderWeek,m.StockKey,m.OrderYearWeek,m.isFix,m.masterCount,m.OrderYear
   ORDER BY CAST(m.OrderYear AS NVARCHAR(4))+REPLACE(m.OrderWeek,'-','')`);

const fixRows = await select(`
  SELECT sm.OrderWeek,
         COUNT(DISTINCT sm.ShipmentKey) shipmentMasters,
         SUM(CASE WHEN ISNULL(sm.isFix,0)=1 THEN 1 ELSE 0 END) fixedMasters,
         SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) positiveDetails,
         SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fixedDetails,
         SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfixedDetails,
         SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 AND ISNULL(sm.isFix,0)<>ISNULL(sd.isFix,0) THEN 1 ELSE 0 END) masterDetailMismatch
    FROM ShipmentMaster sm
    LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
   WHERE sm.OrderYear=@yr AND ISNULL(sm.isDeleted,0)=0
   GROUP BY sm.OrderWeek
   ORDER BY REPLACE(sm.OrderWeek,'-','')`);

const formulaRows = await select(`
  WITH ranked_master AS (
    SELECT sm.*,
           ROW_NUMBER() OVER (PARTITION BY sm.OrderYear,sm.OrderWeek ORDER BY sm.StockKey DESC) rn
      FROM StockMaster sm
     WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr
  ), current_stock AS (
    SELECT sm.StockKey,sm.OrderYear,sm.OrderWeek,
           REPLACE(sm.OrderYearWeek,'-','') currentOrderYearWeek,
           ps.ProdKey,CAST(ps.Stock AS DECIMAL(28,6)) actualStock
      FROM ranked_master sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
     WHERE sm.rn=1
  ), incoming AS (
    SELECT OrderWeek,ProdKey,SUM(ISNULL(OutQuantity,0)) qty
      FROM ViewWarehouse
     WHERE OrderYear=@yr
     GROUP BY OrderWeek,ProdKey
  ), outgoing AS (
    SELECT OrderWeek,ProdKey,
           SUM(ISNULL(OutQuantity,0)) allQty,
           SUM(CASE WHEN ISNULL(DetailFix,0)=1 THEN ISNULL(OutQuantity,0) ELSE 0 END) fixedQty,
           SUM(CASE WHEN ISNULL(OutQuantity,0)>0 AND ISNULL(DetailFix,0)=0 THEN 1 ELSE 0 END) unfixedCount
      FROM ViewShipment
     WHERE OrderYear=@yr
     GROUP BY OrderWeek,ProdKey
  ), adjustment AS (
    SELECT sh.OrderWeek,sh.ProdKey,SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) qty
      FROM StockHistory sh
      JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
     WHERE sh.OrderYear=@yr
     GROUP BY sh.OrderWeek,sh.ProdKey
  )
  SELECT c.OrderWeek,c.StockKey,c.ProdKey,p.ProdName,p.CounName,p.FlowerName,
         c.actualStock,
         CAST(ISNULL(prev.Stock,0) AS DECIMAL(28,6)) previousStock,
         prev.OrderYear previousYear,prev.OrderWeek previousWeek,
         CAST(ISNULL(i.qty,0) AS DECIMAL(28,6)) incomingQty,
         CAST(ISNULL(o.fixedQty,0) AS DECIMAL(28,6)) fixedOutgoingQty,
         CAST(ISNULL(o.allQty,0) AS DECIMAL(28,6)) allOutgoingQty,
         ISNULL(o.unfixedCount,0) unfixedCount,
         CAST(ISNULL(a.qty,0) AS DECIMAL(28,6)) adjustmentQty,
         CAST(c.actualStock-(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)-ISNULL(o.fixedQty,0)+ISNULL(a.qty,0)) AS DECIMAL(28,6)) spGap,
         CAST(c.actualStock-(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)-ISNULL(o.allQty,0)+ISNULL(a.qty,0)) AS DECIMAL(28,6)) screenGap
    FROM current_stock c
    JOIN Product p ON p.ProdKey=c.ProdKey
    OUTER APPLY (
      SELECT TOP 1 ps.Stock,pm.OrderYear,pm.OrderWeek
        FROM StockMaster pm
        JOIN ProductStock ps ON ps.StockKey=pm.StockKey AND ps.ProdKey=c.ProdKey
       WHERE REPLACE(pm.OrderYearWeek,'-','') < c.currentOrderYearWeek
       ORDER BY REPLACE(pm.OrderYearWeek,'-','') DESC,pm.StockKey DESC
    ) prev
    LEFT JOIN incoming i ON i.OrderWeek=c.OrderWeek AND i.ProdKey=c.ProdKey
    LEFT JOIN outgoing o ON o.OrderWeek=c.OrderWeek AND o.ProdKey=c.ProdKey
    LEFT JOIN adjustment a ON a.OrderWeek=c.OrderWeek AND a.ProdKey=c.ProdKey
   ORDER BY REPLACE(c.OrderWeek,'-',''),c.ProdKey`);

const missingSnapshotRows = await select(`
  WITH ranked_master AS (
    SELECT sm.StockKey,sm.OrderWeek,
           ROW_NUMBER() OVER (PARTITION BY sm.OrderYear,sm.OrderWeek ORDER BY sm.StockKey DESC) rn
      FROM StockMaster sm WHERE CAST(sm.OrderYear AS NVARCHAR(4))=@yr
  ), flow_product AS (
    SELECT OrderWeek,ProdKey FROM ViewWarehouse WHERE OrderYear=@yr
    UNION
    SELECT OrderWeek,ProdKey FROM ViewShipment WHERE OrderYear=@yr
    UNION
    SELECT sh.OrderWeek,sh.ProdKey FROM StockHistory sh
      JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
     WHERE sh.OrderYear=@yr
  )
  SELECT fp.OrderWeek,fp.ProdKey,p.ProdName
    FROM flow_product fp
    JOIN ranked_master sm ON sm.OrderWeek=fp.OrderWeek AND sm.rn=1
    JOIN Product p ON p.ProdKey=fp.ProdKey
    LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=fp.ProdKey
   WHERE ps.ProdKey IS NULL
   ORDER BY REPLACE(fp.OrderWeek,'-',''),fp.ProdKey`);

const crossYearRows = await select(`
  SELECT currentYear.OrderWeek,
         COUNT(DISTINCT CAST(otherYear.OrderYear AS NVARCHAR(4))) otherYearCount,
         MIN(CAST(otherYear.OrderYear AS NVARCHAR(4))) firstOtherYear,
         MAX(CAST(otherYear.OrderYear AS NVARCHAR(4))) lastOtherYear
    FROM StockMaster currentYear
    JOIN StockMaster otherYear ON otherYear.OrderWeek=currentYear.OrderWeek
                              AND CAST(otherYear.OrderYear AS NVARCHAR(4))<>@yr
   WHERE CAST(currentYear.OrderYear AS NVARCHAR(4))=@yr
   GROUP BY currentYear.OrderWeek
   ORDER BY REPLACE(currentYear.OrderWeek,'-','')`);

const latest = masterRows.at(-1);
const liveGaps = latest ? await select(`
  SELECT p.ProdKey,p.ProdName,
         CAST(ISNULL(p.Stock,0) AS DECIMAL(28,6)) liveStock,
         CAST(ISNULL(ps.Stock,0) AS DECIMAL(28,6)) latestSnapshot,
         CAST(ISNULL(p.Stock,0)-ISNULL(ps.Stock,0) AS DECIMAL(28,6)) gap
    FROM Product p
    JOIN ProductStock ps ON ps.ProdKey=p.ProdKey AND ps.StockKey=${Number(latest.StockKey)}
   WHERE ABS(ISNULL(p.Stock,0)-ISNULL(ps.Stock,0))>${Number(tolerance)}
   ORDER BY ABS(ISNULL(p.Stock,0)-ISNULL(ps.Stock,0)) DESC`) : [];

const fixByWeek = new Map(fixRows.map((row) => [row.OrderWeek, row]));
const spMismatches = formulaRows.filter((row) => Math.abs(Number(row.spGap)) > tolerance);
const screenMismatchesOnFixedWeeks = formulaRows.filter((row) => {
  const fix = fixByWeek.get(row.OrderWeek);
  return Number(fix?.unfixedDetails || 0) === 0 && Math.abs(Number(row.screenGap)) > tolerance;
});
const negativeRows = formulaRows.filter((row) => Number(row.actualStock) < -tolerance);
const confirmedNegativeRows = negativeRows.filter((row) => Number(fixByWeek.get(row.OrderWeek)?.fixedDetails || 0) > 0);
const malformedMasters = masterRows.filter((row) => !/^\d{2}-\d{2}$/.test(String(row.OrderWeek || '')));
const duplicateMasters = masterRows.filter((row) => Number(row.masterCount) > 1);
const orderYearWeekMismatches = masterRows.filter((row) => Number(row.orderYearWeekMismatch) > 0);
const fixMismatches = fixRows.filter((row) => Number(row.masterDetailMismatch) > 0);

const byWeek = masterRows.map((master) => {
  const stockRows = formulaRows.filter((row) => row.OrderWeek === master.OrderWeek);
  const fix = fixByWeek.get(master.OrderWeek) || {};
  return {
    orderWeek: master.OrderWeek,
    stockKey: master.StockKey,
    snapshotCount: master.snapshotCount,
    stockMasterIsFix: master.isFix,
    fixedDetails: Number(fix.fixedDetails || 0),
    unfixedDetails: Number(fix.unfixedDetails || 0),
    masterDetailMismatch: Number(fix.masterDetailMismatch || 0),
    spMismatchCount: stockRows.filter((row) => Math.abs(Number(row.spGap)) > tolerance).length,
    fixedScreenMismatchCount: Number(fix.unfixedDetails || 0) === 0
      ? stockRows.filter((row) => Math.abs(Number(row.screenGap)) > tolerance).length : 0,
    negativeCount: stockRows.filter((row) => Number(row.actualStock) < -tolerance).length,
  };
});

const result = {
  audit: 'READ_ONLY_STOCK_ALL_WEEKS',
  year,
  tolerance,
  range: { firstWeek: masterRows[0]?.OrderWeek || null, lastWeek: latest?.OrderWeek || null, weekCount: masterRows.length },
  summary: {
    spMismatchCount: spMismatches.length,
    fixedScreenMismatchCount: screenMismatchesOnFixedWeeks.length,
    negativeSnapshotCount: negativeRows.length,
    confirmedNegativeCount: confirmedNegativeRows.length,
    missingFlowSnapshotCount: missingSnapshotRows.length,
    duplicateMasterWeekCount: duplicateMasters.length,
    malformedMasterCount: malformedMasters.length,
    orderYearWeekMismatchCount: orderYearWeekMismatches.length,
    shipmentFixMismatchWeekCount: fixMismatches.length,
    latestProductLiveGapCount: liveGaps.length,
    sameNamedWeekOtherYearCount: crossYearRows.length,
  },
  byWeek,
  issues: {
    spMismatches: spMismatches.slice(0, 300),
    fixedScreenMismatches: screenMismatchesOnFixedWeeks.slice(0, 300),
    negativeSnapshots: negativeRows.slice(0, 300),
    confirmedNegatives: confirmedNegativeRows.slice(0, 300),
    missingFlowSnapshots: missingSnapshotRows.slice(0, 300),
    duplicateMasters,
    malformedMasters,
    orderYearWeekMismatches,
    shipmentFixMismatches: fixMismatches,
    latestProductLiveGaps: liveGaps.slice(0, 300),
  },
  crossYearSameWeekDiagnostics: crossYearRows,
  notes: [
    'StockMaster.isFix is reported only as a diagnostic and is not a failure condition.',
    'spGap uses only ViewShipment.DetailFix=1 and is the stored snapshot invariant.',
    'screenGap uses every ViewShipment row and is asserted only when the week has no positive unfixed details.',
    'Previous stock follows EXE Common.GetBeforeOrderYearWeek ordering across the full OrderYearWeek key.',
  ],
};

console.log(JSON.stringify(result, null, 2));
await pool.close();

const blockingCount = spMismatches.length + screenMismatchesOnFixedWeeks.length +
  confirmedNegativeRows.length + missingSnapshotRows.length + duplicateMasters.length +
  malformedMasters.length + orderYearWeekMismatches.length + fixMismatches.length;
if (blockingCount > 0) process.exitCode = 2;
