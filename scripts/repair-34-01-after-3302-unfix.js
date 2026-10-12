#!/usr/bin/env node
/**
 * Repair 2026-08-21: 33-02 was unfixed while 34-01 stayed confirmed.
 * Restore EXE week order by cancelling 34-01 for the broken CountryFlower set,
 * then recalc from 33-02.
 *
 *   node scripts/repair-34-01-after-3302-unfix.js
 *   node scripts/repair-34-01-after-3302-unfix.js --apply
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
const sql = require(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mssql'))
  ? 'mssql'
  : 'C:/Users/USER/nenova-erp-ui/node_modules/mssql');

const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const UNFIX_WEEK = '34-01';
const CALC_WEEK = '33-02';
const UID = 'web';
const CATEGORIES = [
  '콜롬비아장미',
  '콜롬비아수국',
  '중국장미',
  '중국기타',
  '베트남호접난 Orchid',
  '네덜란드',
];

async function snapshot(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM Product WHERE ISNULL(isDeleted,0)=0 AND Stock<0) liveNeg,
      (SELECT CAST(SUM(Stock) AS decimal(18,2)) FROM Product WHERE ISNULL(isDeleted,0)=0 AND Stock<0 AND CountryFlower=N'콜롬비아장미') roseLiveSum,
      (SELECT CAST(Stock AS decimal(18,2)) FROM Product WHERE ProdKey=1426) mondialLive,
      (SELECT COUNT(*) FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01' AND ISNULL(sd.isFix,0)=1
          AND p.CountryFlower IN (N'콜롬비아장미',N'콜롬비아수국',N'중국장미',N'중국기타',N'베트남호접난 Orchid',N'네덜란드')
          AND ISNULL(sd.OutQuantity,0)>0) fix3401Rows
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

  console.log('before', await snapshot(pool));
  console.log(APPLY ? 'APPLY 34-01 unfix then 33-02 calc' : 'dry-run only');

  if (!APPLY) {
    await pool.close();
    return;
  }

  for (const cf of CATEGORIES) {
    const r = await pool.request()
      .input('yr', sql.NVarChar, YEAR)
      .input('wk', sql.NVarChar, UNFIX_WEEK)
      .input('cf', sql.NVarChar, cf)
      .input('uid', sql.NVarChar, UID)
      .query(`
        DECLARE @r INT, @m NVARCHAR(MAX);
        EXEC dbo.usp_ShipmentFixCancel
             @OrderYear = @yr, @OrderWeek = @wk, @CountryFlower = @cf,
             @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
        SELECT ISNULL(@r, 0) AS result, @m AS message;
      `);
    const row = r.recordset?.[0] || {};
    console.log('unfix', cf, row);
    if (Number(row.result || 0) !== 0) {
      throw new Error(`usp_ShipmentFixCancel failed for ${cf}: ${row.message}`);
    }
  }

  const calc = await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, CALC_WEEK)
    .input('pk', sql.Int, 0)
    .input('uid', sql.NVarChar, UID)
    .query(`
      DECLARE @r INT, @m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation
           @OrderYear = @yr, @OrderWeek = @wk, @ProdKey = @pk,
           @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
      SELECT ISNULL(@r, 0) AS result, @m AS message;
    `);
  console.log('calc 33-02', calc.recordset?.[0]);
  if (Number(calc.recordset?.[0]?.result || 0) !== 0) {
    throw new Error(`usp_StockCalculation failed: ${calc.recordset?.[0]?.message}`);
  }

  console.log('after', await snapshot(pool));
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
