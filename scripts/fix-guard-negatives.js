#!/usr/bin/env node
/**
 * exe 확정 가드(remain/productRemain<0) 잔여 정리
 * 1) 26-01잔량정리 StockHistory 전부 삭제 (sync 부작용)
 * 2) 재계산
 * 3) 가드 잔여 품목 Product.Stock 보정 (productRemain>=0)
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const SKIP_SYNC_DELETE = process.argv.includes('--skip-sync-delete');
const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const UID = 'nenovaSS3';
const orderYearWeek = YEAR + WEEK.replace('-', '');
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function runCalc(pool, week, pk) {
  await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, week)
    .input('pk', sql.Int, pk)
    .input('uid', sql.NVarChar, UID)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
}

async function loadGuardRows(pool) {
  const r = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
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
      WHERE sh.OrderWeek = @wk AND ${MANUAL}
        AND ISNULL(sh.Descr, '') NOT LIKE N'26-01잔량정리:%'
      GROUP BY sh.ProdKey
    ),
    stock_base AS (
      SELECT
        p.ProdKey, p.ProdName,
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
    SELECT *, prevStock + inQty - outQty AS remain, productStock + inQty - outQty AS productRemain
    FROM stock_base
    WHERE prevStock + inQty - outQty < 0 OR productStock + inQty - outQty < 0
    ORDER BY remain`);
  return r.recordset;
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

  const syncHist = SKIP_SYNC_DELETE
    ? { recordset: [] }
    : await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.BeforeValue, sh.AfterValue, sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE sh.OrderYear = @yr AND sh.OrderWeek = @wk
       AND ISNULL(sh.Descr, '') LIKE N'26-01잔량정리:%'`);

  const before = await loadGuardRows(pool);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK}`);
  console.log(`26-01잔량정리 history: ${syncHist.recordset.length}`);
  console.log(`guard negative: ${before.length}\n`);

  for (const r of before) {
    console.log(`pk=${r.ProdKey} remain=${Math.round(r.remain * 10) / 10} prodRem=${Math.round(r.productRemain * 10) / 10} | ${String(r.ProdName).slice(0, 50)}`);
  }

  if (!APPLY) {
    console.log('\nAdd --apply');
    await pool.close();
    return;
  }

  const pks = new Set(syncHist.recordset.map((r) => r.ProdKey));
  for (const r of syncHist.recordset) {
    await pool.request().input('shk', sql.Int, r.StockHistoryKey)
      .query(`DELETE FROM StockHistory WHERE StockHistoryKey = @shk`);
  }

  for (const pk of pks) {
    await runCalc(pool, WEEK, pk);
    await new Promise((res) => setTimeout(res, 40));
  }

  let guard = await loadGuardRows(pool);
  for (const row of guard) {
    const pk = row.ProdKey;
    let stock = Number(row.productStock);
    const inQty = Number(row.inQty);
    const outQty = Number(row.outQty);
    const productRemain = stock + inQty - outQty;
    if (productRemain < -0.001) {
      stock = Math.ceil((outQty - inQty) * 1000) / 1000;
      if (stock < 0) stock = 0;
      await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, stock)
        .query(`UPDATE Product SET Stock = @s WHERE ProdKey = @pk`);
      await runCalc(pool, WEEK, pk);
      pks.add(pk);
    }
    const remain = Number(row.prevStock) + inQty - outQty;
    if (remain < -0.001 && productRemain >= -0.001) {
      await runCalc(pool, '25-02', pk);
      await runCalc(pool, WEEK, pk);
      pks.add(pk);
    }
  }

  guard = await loadGuardRows(pool);
  for (const row of guard) {
    const pk = row.ProdKey;
    const remain = Number(row.remain);
    const productRemain = Number(row.productRemain);
    if (remain < -0.001) {
      const bump = Math.ceil(-remain * 1000) / 1000;
      const newStock = Math.max(0, Number(row.productStock) + bump);
      await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, newStock)
        .query(`UPDATE Product SET Stock = @s WHERE ProdKey = @pk`);
      await runCalc(pool, WEEK, pk);
    } else if (productRemain < -0.001) {
      const newStock = Math.ceil((Number(row.outQty) - Number(row.inQty)) * 1000) / 1000;
      await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, Math.max(0, newStock))
        .query(`UPDATE Product SET Stock = @s WHERE ProdKey = @pk`);
      await runCalc(pool, WEEK, pk);
    }
  }

  const after = await loadGuardRows(pool);
  const liveNeg = await pool.request().query(`SELECT COUNT(*) cnt FROM Product WHERE isDeleted=0 AND ISNULL(Stock,0)<0`);

  console.log(`\nDone: syncHistDeleted=${syncHist.recordset.length}, guardRemaining=${after.length}, live<0=${liveNeg.recordset[0].cnt}`);
  for (const r of after) {
    console.log(`  still pk=${r.ProdKey} remain=${r.remain} prodRem=${r.productRemain}`);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
