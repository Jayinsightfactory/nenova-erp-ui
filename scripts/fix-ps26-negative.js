#!/usr/bin/env node
/** Delete 26-01 StockHistory with AfterValue<0 and recalc (ps26 negative guard) */
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
const flowerArg = process.argv.find((a) => a.startsWith('--flower='));
const FLOWER = flowerArg ? flowerArg.slice('--flower='.length) : '';
const UID = 'nenovaSS3';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  const flowerFilter = FLOWER
    ? `AND (p.FlowerName LIKE N'%${FLOWER.replace(/'/g, "''")}%' OR p.ProdName LIKE N'%${FLOWER.replace(/'/g, "''")}%')`
    : '';

  const negPs = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) AS live, ISNULL(ps.Stock,0) AS ps26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey = ps.StockKey
         WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yr + REPLACE(@wk, '-', '')
      ) ps(Stock)
     WHERE ISNULL(p.isDeleted,0) = 0
       AND ISNULL(ps.Stock,0) < 0
       ${flowerFilter}
     ORDER BY ps.Stock`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ps26<0 | ${WEEK} ${FLOWER || '전체'}`);
  console.log(`count: ${negPs.recordset.length}\n`);
  for (const r of negPs.recordset) {
    console.log(`pk=${r.ProdKey} live=${r.live} ps26=${r.ps26} | ${String(r.ProdName).slice(0, 50)}`);
  }

  if (!APPLY || negPs.recordset.length === 0) {
    console.log('\nAdd --apply to delete AfterValue<0 history and recalc');
    await pool.close();
    return;
  }

  const pks = new Set(negPs.recordset.map((r) => r.ProdKey));
  for (const pk of pks) {
    const hist = await pool.request()
      .input('pk', sql.Int, pk)
      .input('wk', sql.NVarChar, WEEK)
      .input('yr', sql.NVarChar, YEAR)
      .query(`
      SELECT StockHistoryKey, BeforeValue, AfterValue, Descr
        FROM StockHistory
       WHERE ProdKey = @pk AND OrderYear = @yr AND OrderWeek = @wk
         AND ISNULL(AfterValue, 0) < 0`);
    for (const h of hist.recordset) {
      await pool.request().input('shk', sql.Int, h.StockHistoryKey)
        .query(`DELETE FROM StockHistory WHERE StockHistoryKey = @shk`);
    }
    await pool.request()
      .input('yr', sql.NVarChar, YEAR)
      .input('wk', sql.NVarChar, WEEK)
      .input('pk', sql.Int, pk)
      .input('uid', sql.NVarChar, UID)
      .query(`DECLARE @r INT,@m NVARCHAR(200);
        EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
  }

  const after = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('f', sql.NVarChar, FLOWER ? `%${FLOWER}%` : '%')
    .query(FLOWER ? `
      SELECT COUNT(*) cnt FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey = ps.StockKey
         WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yr + REPLACE(@wk, '-', '')
      ) ps(Stock)
     WHERE ISNULL(ps.Stock,0) < 0 AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f)` : `
      SELECT COUNT(*) cnt FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey = ps.StockKey
         WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yr + REPLACE(@wk, '-', '')
      ) ps(Stock)
     WHERE ISNULL(ps.Stock,0) < 0`);

  console.log(`\nDone: recalc=${pks.size}, ps26 negative remaining=${after.recordset[0].cnt}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
