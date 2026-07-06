#!/usr/bin/env node
/**
 * exe 확정 가드 잔여(remain/productRemain<0) — 수동보정 이력 + live 보정
 * reconcile이 삭제하지 않는 Descr: 수동보정:차수잔량
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
const UID = 'nenovaSS3';
const YWS = YEAR + WEEK.replace('-', '');
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function runCalc(pool, pk) {
  await pool.request().input('yr', sql.NVarChar, YEAR).input('wk', sql.NVarChar, WEEK)
    .input('pk', sql.Int, pk).input('uid', sql.NVarChar, UID)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
}

async function loadGuardRows(pool) {
  const r = await pool.request().input('wk', sql.NVarChar, WEEK).input('yr', sql.NVarChar, YEAR).input('ywk', sql.NVarChar, YWS)
    .query(`
    WITH out_qty AS (
      SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0 GROUP BY sd.ProdKey
    ), in_qty AS (
      SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseMaster wm
      JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      WHERE wm.OrderWeek=@wk AND wm.isDeleted=0 GROUP BY wd.ProdKey
    ), adjust_qty AS (
      SELECT sh.ProdKey, SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjustQty FROM StockHistory sh
      WHERE sh.OrderWeek=@wk AND ${MANUAL} AND ISNULL(sh.Descr,'') NOT LIKE N'%잔량정리:%' GROUP BY sh.ProdKey
    ), stock_base AS (
      SELECT p.ProdKey, p.ProdName, ISNULL(prev.prevStock,ISNULL(p.Stock,0)) prevStock, ISNULL(p.Stock,0) productStock,
        ISNULL(iq.inQty,0)+ISNULL(aq.adjustQty,0) inQty, ISNULL(oq.outQty,0) outQty
      FROM out_qty oq JOIN Product p ON p.ProdKey=oq.ProdKey AND p.isDeleted=0
      LEFT JOIN in_qty iq ON iq.ProdKey=oq.ProdKey LEFT JOIN adjust_qty aq ON aq.ProdKey=oq.ProdKey
      OUTER APPLY (
        SELECT TOP 1 ps.Stock prevStock FROM ProductStock ps JOIN StockMaster sm2 ON ps.StockKey=sm2.StockKey
        WHERE ps.ProdKey=p.ProdKey AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)),@yr)+REPLACE(sm2.OrderWeek,'-','')<@ywk
        ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)),@yr)+REPLACE(sm2.OrderWeek,'-','') DESC
      ) prev
    )
    SELECT *, prevStock+inQty-outQty remain, productStock+inQty-outQty productRemain FROM stock_base
    WHERE prevStock+inQty-outQty<0 OR productStock+inQty-outQty<0 ORDER BY remain`);
  return r.recordset;
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 600000 },
  });

  const before = await loadGuardRows(pool);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK} | guard=${before.length}`);
  for (const r of before) {
    console.log(`  pk=${r.ProdKey} remain=${r.remain} prodRem=${r.productRemain} live=${r.productStock} | ${String(r.ProdName).slice(0, 45)}`);
  }
  if (!APPLY) { console.log('\nAdd --apply'); await pool.close(); return; }

  for (const row of before) {
    const pk = row.ProdKey;
    const remain = Number(row.remain);
    const prodRem = Number(row.productRemain);
    let live = Number(row.productStock);

    if (remain < -0.001) {
      const delta = Math.ceil(-remain * 1000) / 1000;
      const beforeVal = live;
      const afterVal = beforeVal + delta;
      await pool.request()
        .input('pk', sql.Int, pk)
        .input('before', sql.Float, beforeVal)
        .input('after', sql.Float, afterVal)
        .input('yr', sql.NVarChar, YEAR)
        .input('wk', sql.NVarChar, WEEK)
        .input('uid', sql.NVarChar, UID)
        .query(`INSERT INTO StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
          VALUES (GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',@before,@after,N'수동보정:차수잔량',@pk)`);
      live = afterVal;
      await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, live).query('UPDATE Product SET Stock=@s WHERE ProdKey=@pk');
      console.log(`pk=${pk} remain adj +${delta}`);
    }

    if (prodRem < -0.001) {
      const need = Math.ceil((Number(row.outQty) - Number(row.inQty)) * 1000) / 1000;
      const delta = Math.max(0, need - live);
      if (delta > 0.001) {
        const beforeVal = live;
        const afterVal = beforeVal + delta;
        await pool.request()
          .input('pk', sql.Int, pk)
          .input('before', sql.Float, beforeVal)
          .input('after', sql.Float, afterVal)
          .input('yr', sql.NVarChar, YEAR)
          .input('wk', sql.NVarChar, WEEK)
          .input('uid', sql.NVarChar, UID)
          .query(`INSERT INTO StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
            VALUES (GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',@before,@after,N'수동보정:차수잔량',@pk)`);
        live = afterVal;
        await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, live).query('UPDATE Product SET Stock=@s WHERE ProdKey=@pk');
        console.log(`pk=${pk} prodRem adj +${delta} live→${live}`);
      }
    }
    await runCalc(pool, pk);
  }

  const after = await loadGuardRows(pool);
  console.log(`\nDone guardRemaining=${after.length}`);
  for (const r of after) console.log(`  still pk=${r.ProdKey} remain=${r.remain} prodRem=${r.productRemain}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
