#!/usr/bin/env node
/** fix-26-02-live-remain.js 롤백 + sync-week-stock-to-live 재실행 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
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

  const bad = await pool.request().query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, sh.BeforeValue, sh.AfterValue, p.ProdName
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.OrderWeek=N'26-02' AND ISNULL(sh.Descr,'') LIKE N'26-02잔량정리:ps0→live0%'
     ORDER BY sh.ProdKey`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | rollback targets=${bad.recordset.length}\n`);
  for (const row of bad.recordset.slice(0, 15)) {
    console.log(`pk=${row.ProdKey} restore live 0→${row.BeforeValue} | ${String(row.ProdName).slice(0, 40)}`);
  }
  if (bad.recordset.length > 15) console.log(`... +${bad.recordset.length - 15} more`);

  if (!APPLY) {
    console.log('\nAdd --apply to rollback and re-sync.');
    await pool.close();
    return;
  }

  const prodKeys = new Set();
  for (const row of bad.recordset) {
    await pool.request()
      .input('shk', sql.Int, row.StockHistoryKey)
      .input('pk', sql.Int, row.ProdKey)
      .input('before', sql.Float, Number(row.BeforeValue))
      .query(`
        BEGIN TRANSACTION;
        UPDATE Product SET Stock=@before WHERE ProdKey=@pk;
        DELETE FROM StockHistory WHERE StockHistoryKey=@shk;
        COMMIT;`);
    prodKeys.add(row.ProdKey);
  }
  console.log(`\nRolled back ${bad.recordset.length} rows, ${prodKeys.size} products`);

  for (const pk of [...prodKeys].sort((a, b) => a - b)) {
    const sp = await pool.request()
      .input('yr', sql.NVarChar, '2026')
      .input('wk', sql.NVarChar, '26-02')
      .input('pk', sql.Int, pk)
      .input('uid', sql.NVarChar, UID)
      .query(`
        DECLARE @r INT, @m NVARCHAR(200);
        EXEC dbo.usp_StockCalculation @OrderYear=@yr, @OrderWeek=@wk, @ProdKey=@pk,
             @iUserID=@uid, @oResult=@r OUTPUT, @oMessage=@m OUTPUT;
        SELECT ISNULL(@r,0) AS result;`);
    await new Promise((r) => setTimeout(r, 40));
  }

  await pool.close();
  console.log('\nRe-running sync-week-stock-to-live 26-02 --apply ...');
  execSync('node scripts/sync-week-stock-to-live.js 26-02 --min=1 --apply', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
