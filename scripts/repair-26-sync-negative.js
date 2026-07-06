#!/usr/bin/env node
/** Roll back 26-01잔량정리 that pushed Product.Stock negative (exe 확정 차단) */
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

  const rows = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName,
           sh.BeforeValue, sh.AfterValue, sh.Descr,
           ISNULL(p.Stock,0) AS liveNow
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk
       AND sh.Descr LIKE N'26-01잔량정리:ps→live%'
       AND ISNULL(sh.AfterValue,0) < 0
       ${flowerFilter}
     ORDER BY sh.ProdKey`);

  const negLive = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) AS live
      FROM Product p
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 0
       AND EXISTS (
         SELECT 1 FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk
           AND sh.Descr LIKE N'26-01잔량정리:ps→live%'
       )
       ${flowerFilter}
     ORDER BY p.Stock`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK} ${FLOWER || '전체'}`);
  console.log(`bad StockHistory (ps→live, after<0): ${rows.recordset.length}`);
  console.log(`negative live with bad hist: ${negLive.recordset.length}\n`);

  for (const r of rows.recordset) {
    console.log(
      `shk=${r.StockHistoryKey} pk=${r.ProdKey} ${r.BeforeValue}→${r.AfterValue} live=${r.liveNow}`
      + ` | ${String(r.ProdName).slice(0, 50)}`,
    );
  }

  if (!APPLY) {
    console.log('\nAdd --apply: delete bad history, set Product.Stock=0, usp_StockCalculation');
    await pool.close();
    return;
  }

  const pks = new Set();
  for (const r of rows.recordset) {
    await pool.request().input('shk', sql.Int, r.StockHistoryKey)
      .query(`DELETE FROM StockHistory WHERE StockHistoryKey=@shk`);
    pks.add(r.ProdKey);
  }

  for (const r of negLive.recordset) {
    pks.add(r.ProdKey);
    await pool.request().input('pk', sql.Int, r.ProdKey)
      .query(`UPDATE Product SET Stock = 0 WHERE ProdKey=@pk AND ISNULL(Stock,0) < 0`);
  }

  // 같은 꽃군 음수 live 전부 0 (수동 -1 조정 등)
  if (FLOWER) {
    const extra = await pool.request()
      .input('f', sql.NVarChar, `%${FLOWER}%`)
      .query(`
      SELECT p.ProdKey FROM Product p
       WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 0
         AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f)`);
    for (const r of extra.recordset) {
      pks.add(r.ProdKey);
      await pool.request().input('pk', sql.Int, r.ProdKey)
        .query(`UPDATE Product SET Stock = 0 WHERE ProdKey=@pk`);
    }
  }

  for (const pk of pks) {
    await pool.request()
      .input('yr', sql.NVarChar, YEAR)
      .input('wk', sql.NVarChar, WEEK)
      .input('pk', sql.Int, pk)
      .input('uid', sql.NVarChar, UID)
      .query(`DECLARE @r INT,@m NVARCHAR(200);
        EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
    await new Promise((res) => setTimeout(res, 50));
  }

  const after = await pool.request()
    .input('f', sql.NVarChar, FLOWER ? `%${FLOWER}%` : '%')
    .query(FLOWER ? `
      SELECT COUNT(*) cnt FROM Product p
       WHERE ISNULL(p.Stock,0)<0 AND (p.FlowerName LIKE @f OR p.ProdName LIKE @f)` : `
      SELECT COUNT(*) cnt FROM Product p WHERE ISNULL(p.Stock,0)<0`);

  console.log(`\nDone: deleted=${rows.recordset.length}, recalc=${pks.size}, negative remaining=${after.recordset[0].cnt}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
