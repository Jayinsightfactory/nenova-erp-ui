#!/usr/bin/env node
/** 26-01잔량정리 잘못된 StockHistory 롤백 + 재동기화 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const WEEK = '26-01';
const UID = 'nenovaSS3';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '네덜란드';

async function connect() {
  return sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
}

async function runCalc(pool, pk) {
  await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, WEEK)
    .input('pk', sql.Int, pk)
    .input('uid', sql.NVarChar, UID)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
}

async function main() {
  const pool = await connect();
  const bad = await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('c', sql.NVarChar, `%${COUNTRY}%`)
    .query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.BeforeValue, sh.AfterValue, sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk
       AND sh.Descr LIKE N'26-01잔량정리%'
       AND (p.CounName LIKE @c OR p.CountryFlower LIKE @c)
     ORDER BY sh.ProdKey`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | rollback ${bad.recordset.length} rows (${COUNTRY})\n`);
  for (const r of bad.recordset) {
    console.log(`shk=${r.StockHistoryKey} pk=${r.ProdKey} ${r.BeforeValue}→${r.AfterValue} | ${r.Descr?.slice(0, 50)}`);
  }

  if (!APPLY) {
    console.log('\nAdd --apply to delete and recalc.');
    await pool.close();
    return;
  }

  const pks = [...new Set(bad.recordset.map((r) => r.ProdKey))];
  for (const r of bad.recordset) {
    await pool.request().input('shk', sql.Int, r.StockHistoryKey)
      .query(`DELETE FROM StockHistory WHERE StockHistoryKey=@shk`);
  }

  for (const pk of pks) {
    await runCalc(pool, pk);
    await new Promise((res) => setTimeout(res, 40));
  }
  console.log(`\nDeleted ${bad.recordset.length}, recalc ${pks.length} products.`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
