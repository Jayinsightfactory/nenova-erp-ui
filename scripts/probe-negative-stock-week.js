#!/usr/bin/env node
/** 25-01 음수 Product.Stock 품목 — 잔량 분해 진단 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const YEAR = process.argv.find((a) => /^\d{4}$/.test(a)) || '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '25-01';
const YWS = YEAR + WEEK.replace('-', '');
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

  const neg = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, p.Stock AS liveStock
      FROM Product p
     WHERE p.isDeleted=0 AND ISNULL(p.Stock,0) < 0
       AND EXISTS (
         SELECT 1 FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
       )
     ORDER BY p.Stock ASC`);

  console.log(`=== ${WEEK} negative Product.Stock: ${neg.recordset.length} ===\n`);

  for (const row of neg.recordset) {
    const pk = row.ProdKey;
    const detail = await pool.request()
      .input('pk', sql.Int, pk)
      .input('yws', sql.NVarChar, YWS)
      .input('yr', sql.NVarChar, YEAR)
      .input('wk', sql.NVarChar, WEEK)
      .query(`
      SELECT
        ISNULL(prev.prevStock,0) AS prevStock,
        ISNULL(inc.inQty,0) AS inQty,
        ISNULL(adj.adjQty,0) AS adjQty,
        ISNULL(out25.outQty,0) AS outQty25,
        ISNULL(outAll.outQty,0) AS outQtyAllFixed,
        ISNULL(incAll.inQty,0) AS inQtyAll,
        ISNULL(ps25.Stock,0) AS ps25,
        ISNULL(p.Stock,0) AS liveStock
      FROM Product p
      LEFT JOIN (
        SELECT TOP 1 ps.Stock AS prevStock
          FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=@pk
           AND ISNULL(sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) < @yws
         ORDER BY ISNULL(sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) DESC
      ) prev ON 1=1
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) AS inQty
          FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey=@pk AND (wm.OrderYear+REPLACE(wm.OrderWeek,'-',''))=@yws
      ) inc
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) AS adjQty
          FROM StockHistory sh
         WHERE sh.ProdKey=@pk AND (sh.OrderYear+REPLACE(sh.OrderWeek,'-',''))=@yws AND ${MANUAL}
      ) adj
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) AS outQty
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=@pk AND ISNULL(sd.isFix,0)=1
           AND (sm.OrderYear+REPLACE(sm.OrderWeek,'-',''))=@yws
      ) out25
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) AS outQty
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=@pk AND ISNULL(sd.isFix,0)=1
           AND (sm.OrderYear+REPLACE(sm.OrderWeek,'-','')) <= @yws
      ) outAll
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) AS inQty
          FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey=@pk AND (wm.OrderYear+REPLACE(wm.OrderWeek,'-','')) <= @yws
      ) incAll
      OUTER APPLY (
        SELECT TOP 1 ps.Stock
          FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=@pk AND ISNULL(sm.OrderYearWeek, sm.OrderYear+REPLACE(sm.OrderWeek,'-',''))=@yws
         ORDER BY ps.StockKey DESC
      ) ps25(Stock)
      WHERE p.ProdKey=@pk`);

    const d = detail.recordset[0] || {};
    const remain25 = Number(d.prevStock) + Number(d.inQty) + Number(d.adjQty) - Number(d.outQty25);
    const impliedLive = Number(d.inQtyAll) - Number(d.outQtyAllFixed);
    console.log(`pk=${pk} ${row.ProdName}`);
    console.log(`  live=${d.liveStock} ps25=${d.ps25} remain25=${remain25.toFixed(2)}`);
    console.log(`  prev=${d.prevStock} in25=${d.inQty} out25=${d.outQty25} adj25=${d.adjQty}`);
    console.log(`  inAll=${d.inQtyAll} outAllFixed=${d.outQtyAllFixed} implied(in-out)=${impliedLive}`);
    console.log('');
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
