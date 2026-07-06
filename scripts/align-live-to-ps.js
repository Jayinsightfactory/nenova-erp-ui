#!/usr/bin/env node
/** gap 품목 Product.Stock = ProductStock(ps) 강제 일치 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const APPLY = process.argv.includes('--apply');
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const YWS = '2026' + WEEK.replace('-', '');
const countryFilter = COUNTRY
  ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
  : '';
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const rows = await pool.request().input('yws', sql.NVarChar, YWS).query(`
    SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) ps(Stock)
     WHERE ISNULL(p.isDeleted,0)=0 AND ABS(ISNULL(p.Stock,0)-ISNULL(ps.Stock,0))>=0.01
       ${countryFilter}
     ORDER BY ABS(ISNULL(p.Stock,0)-ISNULL(ps.Stock,0)) DESC`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | live!=ps: ${rows.recordset.length}`);
  for (const r of rows.recordset.slice(0, 20)) {
    console.log(`pk=${r.ProdKey} live=${r.live} → ps=${r.ps} | ${String(r.ProdName).slice(0, 45)}`);
  }
  if (APPLY) {
    for (const r of rows.recordset) {
      await pool.request().input('pk', sql.Int, r.ProdKey).input('s', sql.Float, Math.max(0, Number(r.ps)))
        .query('UPDATE Product SET Stock=@s WHERE ProdKey=@pk');
    }
    const neg = await pool.request().query('SELECT COUNT(*) cnt FROM Product WHERE isDeleted=0 AND ISNULL(Stock,0)<0');
    console.log(`aligned=${rows.recordset.length}, live<0=${neg.recordset[0].cnt}`);
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
