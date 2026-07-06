#!/usr/bin/env node
/** psGap/liveGap 품목 usp_StockCalculation + live=ps */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '25-01';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const YWS = YEAR + WEEK.replace('-', '');
const UID = 'nenovaSS3';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;
const countryFilter = COUNTRY
  ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
  : '';

async function loadGaps(pool) {
  const r = await pool.request().input('yws', sql.NVarChar, YWS).input('wk', sql.NVarChar, WEEK).input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live, ISNULL(cur.Stock,0) ps,
           ISNULL(prev.Stock,0) prevPs, ISNULL(inc.inQty,0) inQty, ISNULL(out26.outQty,0) outQty, ISNULL(adj26.adjQty,0) adj26
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) cur(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC) prev(Stock)
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0) inc
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0) out26
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj26
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL ${countryFilter}`);
  const gaps = [];
  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const psGap = Number(row.ps) - expected;
    const livePsGap = Number(row.live) - Number(row.ps);
    if (Math.abs(psGap) >= 1 || Math.abs(livePsGap) >= 1) gaps.push({ ...row, expected, psGap, livePsGap });
  }
  return gaps;
}

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 600000 },
  });
  const gaps = await loadGaps(pool);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK} ${COUNTRY || '전체'} | gaps=${gaps.length}`);
  if (!APPLY) { await pool.close(); return; }
  const pks = [...new Set(gaps.map((g) => g.ProdKey))];
  for (const pk of pks) {
    await pool.request().input('yr', sql.NVarChar, YEAR).input('wk', sql.NVarChar, WEEK).input('pk', sql.Int, pk).input('uid', sql.NVarChar, UID)
      .query(`DECLARE @r INT,@m NVARCHAR(200); EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
    const row = await pool.request().input('pk', sql.Int, pk).input('yws', sql.NVarChar, YWS)
      .query(`SELECT ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps FROM Product p OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) ps(Stock) WHERE p.ProdKey=@pk`);
    const ps = Math.max(0, Number(row.recordset[0]?.ps || 0));
    await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, ps).query('UPDATE Product SET Stock=@s WHERE ProdKey=@pk');
  }
  const after = await loadGaps(pool);
  console.log(`recalc=${pks.length}, gapsAfter=${after.length}`);
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
