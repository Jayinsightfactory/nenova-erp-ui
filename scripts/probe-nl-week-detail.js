#!/usr/bin/env node
/** 네덜란드 차수별 prev+입고-출고 vs ProductStock 분석 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '25-01';
const YEAR = '2026';
const YWS = YEAR + WEEK.replace('-', '');
const MIN_PS = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 0.01);
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

  const rows = (await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(prev.Stock,0) AS prevPs,
           ISNULL(inc.inQty,0) AS inQty,
           ISNULL(outq.outQty,0) AS outQty,
           ISNULL(adj.adjQty,0) AS adjQty
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
      ) outq
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj
     WHERE ISNULL(p.isDeleted,0)=0
       AND (p.CounName LIKE N'%네덜란드%' OR p.CountryFlower LIKE N'%네덜란드%')
       AND cur.Stock IS NOT NULL
       AND ISNULL(cur.Stock,0) > 0
     ORDER BY cur.Stock DESC`)).recordset;

  let carryOnly = 0;
  let mismatch = 0;
  console.log(`=== NL ${WEEK} ps>0: ${rows.length} ===\n`);
  for (const row of rows) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adjQty);
    const psGap = Number(row.ps) - expected;
    const isCarry = Number(row.prevPs) > 0 && Number(row.inQty) === 0 && Number(row.outQty) === 0 && Number(row.adjQty) === 0;
    if (isCarry) carryOnly += 1;
    if (Math.abs(psGap) >= 0.01) mismatch += 1;
    console.log(
      `pk=${row.ProdKey} ps=${row.ps} exp=${expected.toFixed(1)} gap=${psGap.toFixed(1)}`
      + ` prev=${row.prevPs} in=${row.inQty} out=${row.outQty} adj=${row.adjQty} live=${row.live}`
      + `${isCarry ? ' [CARRY]' : ''}`
      + `\n  ${String(row.ProdName).slice(0, 55)}`,
    );
  }
  console.log(`\ncarry-only(prev>0, no in/out/adj)=${carryOnly} psGap!=0=${mismatch}`);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
