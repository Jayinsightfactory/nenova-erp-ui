#!/usr/bin/env node
/**
 * 운영 DB 전체 음수 재고 정리 (26-01 확정 차단 해소)
 * 1) 26-01 잘못된 StockHistory(AfterValue<0) 삭제
 * 2) Product.Stock 음수 → 0
 * 3) 해당 품목 usp_StockCalculation(26-01)
 *
 * Usage:
 *   node scripts/fix-all-negative-stock.js
 *   node scripts/fix-all-negative-stock.js 26-01 --apply
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

async function runCalc(pool, prodKey) {
  await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, WEEK)
    .input('pk', sql.Int, prodKey)
    .input('uid', sql.NVarChar, UID)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
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

  const beforeLive = await pool.request().query(`
    SELECT ProdKey, ProdName, ISNULL(Stock,0) AS live
      FROM Product WHERE ISNULL(isDeleted,0)=0 AND ISNULL(Stock,0)<0 ORDER BY Stock`);

  const beforePs = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(ps.Stock,0) AS ps26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) ps(Stock)
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(ps.Stock,0)<0
     ORDER BY ps.Stock`);

  const badHist = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.BeforeValue, sh.AfterValue, sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ISNULL(sh.AfterValue,0)<0
     ORDER BY sh.ProdKey`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK}`);
  console.log(`negative live: ${beforeLive.recordset.length}`);
  console.log(`negative ps26: ${beforePs.recordset.length}`);
  console.log(`26-01 StockHistory AfterValue<0: ${badHist.recordset.length}\n`);

  for (const r of beforeLive.recordset) {
    console.log(`live pk=${r.ProdKey} ${r.live} | ${String(r.ProdName).slice(0, 55)}`);
  }

  if (!APPLY) {
    console.log('\nAdd --apply to execute');
    await pool.close();
    return;
  }

  const pks = new Set([
    ...beforeLive.recordset.map((r) => r.ProdKey),
    ...beforePs.recordset.map((r) => r.ProdKey),
    ...badHist.recordset.map((r) => r.ProdKey),
  ]);

  let deleted = 0;
  for (const r of badHist.recordset) {
    await pool.request().input('shk', sql.Int, r.StockHistoryKey)
      .query(`DELETE FROM StockHistory WHERE StockHistoryKey=@shk`);
    deleted += 1;
  }

  const zeroed = await pool.request().query(`
    UPDATE Product SET Stock = 0 WHERE ISNULL(isDeleted,0)=0 AND ISNULL(Stock,0) < 0;
    SELECT @@ROWCOUNT AS cnt;`);

  for (const pk of pks) {
    await runCalc(pool, pk);
    await new Promise((res) => setTimeout(res, 40));
  }

  const afterLive = await pool.request().query(`
    SELECT COUNT(*) cnt FROM Product WHERE ISNULL(isDeleted,0)=0 AND ISNULL(Stock,0)<0`);

  const afterPs = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .query(`
    SELECT COUNT(*) cnt FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) ps(Stock)
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(ps.Stock,0)<0`);

  console.log(`\nDone: histDeleted=${deleted}, liveZeroed=${zeroed.recordset[0].cnt}, recalc=${pks.size}`);
  console.log(`remaining live<0: ${afterLive.recordset[0].cnt}, ps26<0: ${afterPs.recordset[0].cnt}`);

  if (afterPs.recordset[0].cnt > 0) {
    const still = await pool.request()
      .input('yws', sql.NVarChar, YWS)
      .query(`
      SELECT TOP 20 p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps26
        FROM Product p
        OUTER APPLY (
          SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey=ps.StockKey
           WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
        ) ps(Stock)
       WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(ps.Stock,0)<0 ORDER BY ps.Stock`);
    console.log('\nStill ps26<0:');
    for (const r of still.recordset) {
      console.log(`  pk=${r.ProdKey} live=${r.live} ps26=${r.ps26} | ${String(r.ProdName).slice(0, 50)}`);
    }
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
