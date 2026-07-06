#!/usr/bin/env node
/**
 * 차수잔량(ProductStock) 정합 복구 — 임의 주차·국가
 * Usage:
 *   node scripts/reconcile-week-remain.js 25-01
 *   node scripts/reconcile-week-remain.js 26-01 --country=네덜란드 --apply
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const YWS = YEAR + WEEK.replace('-', '');
const UID = 'nenovaSS3';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;
const BATCH_HIST = `(ISNULL(sh.Descr,'') LIKE N'%잔량정리:%' OR ISNULL(sh.Descr,'') LIKE N'음수정리:%')`;
const countryFilter = COUNTRY
  ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
  : '';
const countryFilterP = COUNTRY
  ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
  : '';

async function runCalc(pool, pk) {
  await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, WEEK)
    .input('pk', sql.Int, pk)
    .input('uid', sql.NVarChar, UID)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
}

async function loadGapReport(pool) {
  const r = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(prev.Stock,0) AS prevPs,
           ISNULL(inc.inQty,0) AS inQty,
           ISNULL(out26.outQty,0) AS outQty,
           ISNULL(adj26.adjQty,0) AS adj26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) cur(Stock)
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek < @yws
         ORDER BY sm.OrderYearWeek DESC
      ) prev(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk
      ) inc
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
      ) out26
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj26
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL
       ${countryFilter}
     ORDER BY p.ProdKey`);

  const issues = [];
  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const psGap = Number(row.ps) - expected;
    const livePsGap = Number(row.live) - Number(row.ps);
    if (Math.abs(psGap) >= 1 || Math.abs(livePsGap) >= 1) {
      issues.push({ ...row, expected, psGap, livePsGap });
    }
  }
  return issues;
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 600000 },
  });

  const badHistSql = COUNTRY ? `
    SELECT sh.StockHistoryKey, sh.ProdKey
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk
       AND (ISNULL(sh.Descr,'') LIKE N'%잔량정리:%' OR ISNULL(sh.Descr,'') LIKE N'음수정리:%')
       ${countryFilterP}` : `
    SELECT StockHistoryKey, ProdKey FROM StockHistory
     WHERE OrderYear=@yr AND OrderWeek=@wk
       AND (ISNULL(Descr,'') LIKE N'%잔량정리:%' OR ISNULL(Descr,'') LIKE N'음수정리:%')`;

  const badHist = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(badHistSql);

  const pksBefore = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT DISTINCT pk FROM (
      SELECT sh.ProdKey AS pk FROM StockHistory sh
      ${COUNTRY ? 'JOIN Product p ON p.ProdKey=sh.ProdKey' : ''}
       WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${BATCH_HIST}
       ${countryFilterP}
      UNION
      SELECT sd.ProdKey FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
        JOIN Product p ON p.ProdKey=sd.ProdKey
       WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
       ${countryFilterP}
      UNION
      SELECT wd.ProdKey FROM WarehouseDetail wd
        JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
        JOIN Product p ON p.ProdKey=wd.ProdKey
       WHERE wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0
       ${countryFilterP}
      UNION
      SELECT sh.ProdKey FROM StockHistory sh
      ${COUNTRY ? 'JOIN Product p ON p.ProdKey=sh.ProdKey' : ''}
       WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
       ${countryFilterP}
    ) u`);

  const gapsBefore = await loadGapReport(pool);
  const label = COUNTRY || '전체';

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK} ${label}`);
  console.log(`bad batch history: ${badHist.recordset.length}`);
  console.log(`recalc targets: ${pksBefore.recordset.length}`);
  console.log(`gap>=1 before: ${gapsBefore.length}`);

  if (!APPLY) {
    console.log('\nAdd --apply');
    await pool.close();
    return;
  }

  for (const h of badHist.recordset) {
    await pool.request().input('shk', sql.Int, h.StockHistoryKey)
      .query(`DELETE FROM StockHistory WHERE StockHistoryKey=@shk`);
  }

  const pks = [...new Set(pksBefore.recordset.map((r) => r.pk))];
  for (const pk of pks) {
    await runCalc(pool, pk);
    await new Promise((res) => setTimeout(res, 30));
  }

  let aligned = 0;
  for (const pk of pks) {
    const row = await pool.request()
      .input('pk', sql.Int, pk)
      .input('yws', sql.NVarChar, YWS)
      .query(`
      SELECT ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps
        FROM Product p
        OUTER APPLY (
          SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey=ps.StockKey
           WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
        ) ps(Stock)
       WHERE p.ProdKey=@pk`);
    if (!row.recordset[0]) continue;
    const ps = Number(row.recordset[0].ps);
    const live = Number(row.recordset[0].live);
    if (Math.abs(live - ps) >= 0.01) {
      await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, ps)
        .query(`UPDATE Product SET Stock=@s WHERE ProdKey=@pk`);
      aligned += 1;
    }
  }

  const gapsAfter = await loadGapReport(pool);
  console.log(`\nDone: histDeleted=${badHist.recordset.length}, recalc=${pks.length}, liveAligned=${aligned}, gapAfter=${gapsAfter.length}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
