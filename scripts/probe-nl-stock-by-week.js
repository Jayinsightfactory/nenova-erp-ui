#!/usr/bin/env node
/** 네덜란드 차수별 ProductStock / live 양수 스캔 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEKS = process.argv.slice(2).filter((a) => /^\d{2}-\d{2}$/.test(a));
const LIST = WEEKS.length ? WEEKS : ['25-01', '25-02', '26-01', '26-02'];
const NL = `AND (p.CounName LIKE N'%네덜란드%' OR p.CountryFlower LIKE N'%네덜란드%')`;

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  for (const wk of LIST) {
    const yws = '2026' + wk.replace('-', '');
    const r = await pool.request().input('yws', sql.NVarChar, yws).query(`
      SELECT COUNT(*) AS cnt,
             SUM(CASE WHEN ISNULL(cur.Stock,0) > 0 THEN 1 ELSE 0 END) AS posPs,
             SUM(CASE WHEN ISNULL(p.Stock,0) > 0 THEN 1 ELSE 0 END) AS posLive,
             SUM(ISNULL(cur.Stock,0)) AS sumPs,
             SUM(ISNULL(p.Stock,0)) AS sumLive
        FROM Product p
        OUTER APPLY (
          SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey = ps.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yws
        ) cur(Stock)
       WHERE ISNULL(p.isDeleted,0) = 0 AND cur.Stock IS NOT NULL ${NL}`);
    const x = r.recordset[0];
    console.log(
      `${wk}: rows=${x.cnt} ps>0=${x.posPs} live>0=${x.posLive}`
      + ` sumPs=${Number(x.sumPs).toFixed(0)} sumLive=${Number(x.sumLive).toFixed(0)}`,
    );
  }

  const pos = await pool.request().query(`
    SELECT TOP 40 p.ProdKey, p.ProdName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(ps26.Stock,0) AS ps26,
           ISNULL(ps25.Stock,0) AS ps2501,
           ISNULL(ps2502.Stock,0) AS ps2502,
           ISNULL(prev.Stock,0) AS prevPs
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek='20262602') ps26(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek='20262501') ps25(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek='20262502') ps2502(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek < '20262602' ORDER BY sm.OrderYearWeek DESC) prev(Stock)
     WHERE ISNULL(p.isDeleted,0)=0 ${NL.replace('AND ', 'AND ')}
       AND (ISNULL(ps26.Stock,0) > 0 OR ISNULL(p.Stock,0) > 0)
     ORDER BY ISNULL(ps26.Stock,0) DESC, ISNULL(p.Stock,0) DESC`);

  console.log(`\n=== NL 26-02 positive (top ${pos.recordset.length}) ===`);
  for (const row of pos.recordset) {
    console.log(
      `pk=${row.ProdKey} ps26=${row.ps26} ps25-01=${row.ps2501} ps25-02=${row.ps2502} prev=${row.prevPs} live=${row.live}`
      + ` | ${String(row.ProdName).slice(0, 55)}`,
    );
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
