#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const pks = process.argv.slice(2).map(Number).filter(Boolean);
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  for (const pk of pks) {
    const r = await pool.request().input('pk', sql.Int, pk).query(`
      SELECT sm.OrderWeek, ps.Stock, p.Stock AS live, ISNULL(sm.isFix,0) AS isFix
        FROM ProductStock ps
        JOIN StockMaster sm ON sm.StockKey=ps.StockKey
        JOIN Product p ON p.ProdKey=ps.ProdKey
       WHERE ps.ProdKey=@pk AND sm.OrderWeek IN ('26-01','26-02')
       ORDER BY sm.OrderWeek`);
    console.log('pk', pk);
    r.recordset.forEach((x) => console.log(`  ${x.OrderWeek} ps=${x.Stock} live=${x.live} fix=${x.isFix}`));
    if (!r.recordset.length) {
      const p = await pool.request().input('pk', sql.Int, pk).query('SELECT Stock AS live FROM Product WHERE ProdKey=@pk');
      console.log('  (no ps rows) live=', p.recordset[0]?.live);
    }
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
