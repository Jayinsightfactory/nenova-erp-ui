#!/usr/bin/env node
/**
 * Restore 34-01 leftover display: confirm 33-02 first, then 34-01,
 * for the categories unfixed at 18:31 to repair the week-order hole.
 *
 *   node scripts/repair-refix-3302-then-3401.js --apply
 */
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const UID = 'web';
const CATEGORIES = [
  '콜롬비아장미',
  '콜롬비아수국',
  '중국장미',
  '중국기타',
  '베트남호접난 Orchid',
  '네덜란드',
];

async function execFix(pool, week, cf) {
  const r = await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, week)
    .input('cf', sql.NVarChar, cf)
    .input('uid', sql.NVarChar, UID)
    .query(`
      DECLARE @r INT, @m NVARCHAR(MAX);
      EXEC dbo.usp_ShipmentFix
           @OrderYear = @yr, @OrderWeek = @wk, @CountryFlower = @cf,
           @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
      SELECT ISNULL(@r, 0) AS result, @m AS message;
    `);
  return r.recordset?.[0] || { result: -1, message: 'no result' };
}

async function execCalc(pool, week) {
  const r = await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, week)
    .input('pk', sql.Int, 0)
    .input('uid', sql.NVarChar, UID)
    .query(`
      DECLARE @r INT, @m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation
           @OrderYear = @yr, @OrderWeek = @wk, @ProdKey = @pk,
           @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
      SELECT ISNULL(@r, 0) AS result, @m AS message;
    `);
  return r.recordset?.[0] || { result: -1, message: 'no result' };
}

async function snap(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT CAST(ps.Stock AS decimal(18,2)) FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=1426 WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01') mondial3401,
      (SELECT CAST(Stock AS decimal(18,2)) FROM Product WHERE ProdKey=1426) mondialLive,
      (SELECT COUNT(*) FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02' AND ISNULL(sd.isFix,0)=1 AND p.CountryFlower=N'콜롬비아장미' AND ISNULL(sd.OutQuantity,0)>0) rose3302Fix,
      (SELECT COUNT(*) FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0 JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01' AND ISNULL(sd.isFix,0)=1 AND p.CountryFlower=N'콜롬비아장미' AND ISNULL(sd.OutQuantity,0)>0) rose3401Fix
  `);
  return r.recordset[0];
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });
  console.log('before', await snap(pool));
  if (!APPLY) {
    console.log('dry-run. pass --apply to confirm 33-02 then 34-01');
    await pool.close();
    return;
  }
  for (const week of ['33-02', '34-01']) {
    for (const cf of CATEGORIES) {
      const row = await execFix(pool, week, cf);
      console.log('fix', week, cf, row);
      if (Number(row.result || 0) !== 0) throw new Error(`${week} ${cf}: ${row.message}`);
    }
    const calc = await execCalc(pool, week);
    console.log('calc', week, calc);
    if (Number(calc.result || 0) !== 0) throw new Error(`calc ${week}: ${calc.message}`);
  }
  console.log('after', await snap(pool));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
