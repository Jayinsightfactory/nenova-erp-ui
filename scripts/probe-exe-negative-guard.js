#!/usr/bin/env node
/** exe fix.js loadNegativeGuardRows 동일 쿼리 카운트 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const orderYear = '2026';
const orderWeek = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const orderYearWeek = orderYear + orderWeek.replace('-', '');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request()
    .input('wk', sql.NVarChar, orderWeek)
    .input('yr', sql.NVarChar, orderYear)
    .input('ywk', sql.NVarChar, orderYearWeek)
    .query(`
    WITH out_qty AS (
      SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
      GROUP BY sd.ProdKey
    ),
    in_qty AS (
      SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
      FROM WarehouseMaster wm
      JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
      WHERE wm.OrderWeek = @wk AND wm.isDeleted = 0
      GROUP BY wd.ProdKey
    ),
    adjust_qty AS (
      SELECT sh.ProdKey, SUM(ISNULL(sh.AfterValue, 0) - ISNULL(sh.BeforeValue, 0)) AS adjustQty
      FROM StockHistory sh
      WHERE sh.OrderWeek = @wk
        AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))
        AND ISNULL(sh.Descr, '') NOT LIKE N'26-01잔량정리:%'
      GROUP BY sh.ProdKey
    ),
    stock_base AS (
      SELECT
        p.ProdKey, p.ProdName, p.FlowerName,
        ISNULL(prev.prevStock, ISNULL(p.Stock, 0)) AS prevStock,
        ISNULL(p.Stock, 0) AS productStock,
        ISNULL(iq.inQty, 0) + ISNULL(aq.adjustQty, 0) AS inQty,
        ISNULL(oq.outQty, 0) AS outQty
      FROM out_qty oq
      JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
      LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
      LEFT JOIN adjust_qty aq ON aq.ProdKey = oq.ProdKey
      OUTER APPLY (
        SELECT TOP 1 ps.Stock AS prevStock
        FROM ProductStock ps
        JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
        WHERE ps.ProdKey = p.ProdKey
          AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') < @ywk
          AND (sm2.isFix IS NULL OR sm2.isFix = 1)
        ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') DESC
      ) prev
    )
    SELECT ProdKey, ProdName, prevStock, productStock, inQty, outQty,
           prevStock + inQty - outQty AS remain,
           productStock + inQty - outQty AS productRemain
    FROM stock_base
    WHERE prevStock + inQty - outQty < 0 OR productStock + inQty - outQty < 0
    ORDER BY remain`);
  console.log(`${orderWeek} exe guard negative: ${r.recordset.length}`);
  for (const row of r.recordset.slice(0, 20)) {
    console.log(`pk=${row.ProdKey} remain=${row.remain} prodRem=${row.productRemain} | ${String(row.ProdName).slice(0, 50)}`);
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
