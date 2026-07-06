#!/usr/bin/env node
/** 26-01 카네이션(및 국가) 음수·확정 상태 진단 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const YWS = YEAR + WEEK.replace('-', '');
const flower = process.argv.find((a) => a.startsWith('--flower='))?.slice('--flower='.length) || '카네이션';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  const neg = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('f', sql.NVarChar, `%${flower}%`)
    .query(`
    SELECT p.ProdKey, p.ProdName, p.CounName, p.FlowerName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(ps.Stock,0) AS ps26,
           ISNULL(out26.outQty,0) AS out26Fixed,
           ISNULL(out26all.outQty,0) AS out26All,
           ISNULL(inc.inQty,0) AS in26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yr+REPLACE(@wk,'-','')
      ) ps(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
      ) out26
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
      ) out26all
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk
      ) inc
     WHERE ISNULL(p.isDeleted,0)=0
       AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f OR p.CountryFlower LIKE @f)
       AND (ISNULL(p.Stock,0) < 0 OR ISNULL(ps.Stock,0) < 0)
     ORDER BY ISNULL(p.Stock,0) ASC`);

  console.log(`=== ${WEEK} ${flower} negative live or ps26: ${neg.recordset.length} ===\n`);
  for (const r of neg.recordset.slice(0, 60)) {
    console.log(
      `pk=${r.ProdKey} live=${Number(r.live).toFixed(1)} ps26=${Number(r.ps26).toFixed(1)}`
      + ` in=${Number(r.in26).toFixed(0)} outFix=${Number(r.out26Fixed).toFixed(0)} outAll=${Number(r.out26all).toFixed(0)}`
      + ` | ${String(r.ProdName).slice(0, 55)}`,
    );
  }

  const hist = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('f', sql.NVarChar, `%${flower}%`)
    .query(`
    SELECT TOP 50 sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.ChangeDtm, sh.ChangeID,
           sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS delta, sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk
       AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f)
       AND ${MANUAL}
     ORDER BY sh.ChangeDtm DESC`);

  console.log(`\n=== ${WEEK} ${flower} manual StockHistory: ${hist.recordset.length} ===\n`);
  for (const h of hist.recordset) {
    console.log(
      `pk=${h.ProdKey} ${h.ChangeDtm?.toISOString?.()?.slice(0, 19)} Δ=${Number(h.delta).toFixed(2)}`
      + ` ${h.BeforeValue}→${h.AfterValue} | ${String(h.Descr||'').slice(0, 55)}`
      + `\n  ${String(h.ProdName).slice(0, 50)}`,
    );
  }

  const fix = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('f', sql.NVarChar, `%${flower}%`)
    .query(`
    SELECT
      COUNT(DISTINCT sd.ProdKey) AS prodCnt,
      SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) AS fixedRows,
      SUM(CASE WHEN ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) AS unfixedRows,
      SUM(CASE WHEN ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS unfixedWithQty
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
    JOIN Product p ON p.ProdKey=sd.ProdKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
      AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f)
      AND ISNULL(sd.OutQuantity,0)>0`);

  console.log(`\n=== ${WEEK} ${flower} ShipmentDetail ===`);
  console.log(fix.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
