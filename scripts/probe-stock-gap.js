const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  for (const label of ['carnation', 'all']) {
    const filter = label === 'carnation'
      ? `(p.FlowerName LIKE N'%카네%' OR p.CountryFlower LIKE N'%카네%' OR p.ProdName LIKE N'%CARNATION%')`
      : `1=1`;
    const r = await pool.request()
      .input('yws', sql.NVarChar, '20262403')
      .query(`
        SELECT TOP 25 p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
               ISNULL(p.Stock,0) AS live, ISNULL(ps.Stock,0) AS snap,
               ISNULL(p.Stock,0) - ISNULL(ps.Stock,0) AS gap
          FROM Product p
          OUTER APPLY (
            SELECT TOP 1 ps2.Stock, sm2.OrderWeek
              FROM ProductStock ps2
              JOIN StockMaster sm2 ON sm2.StockKey = ps2.StockKey
             WHERE ps2.ProdKey = p.ProdKey AND sm2.OrderYearWeek = @yws
             ORDER BY ps2.StockKey DESC
          ) ps(Stock, OrderWeek)
         WHERE p.isDeleted = 0 AND ${filter}
           AND ABS(ISNULL(p.Stock,0) - ISNULL(ps.Stock,0)) >= 5
         ORDER BY ABS(ISNULL(p.Stock,0) - ISNULL(ps.Stock,0)) DESC`);
    console.log(`\n=== ${label} live vs 24-03 snapshot gap >= 5 ===`);
    if (!r.recordset.length) console.log('(none)');
    for (const x of r.recordset) {
      console.log(`pk=${x.ProdKey} live=${x.live} snap=${x.snap} gap=${x.gap} | ${x.ProdName}`);
    }
  }

  await pool.close();
})().catch(e => { console.error(e); process.exit(1); });
