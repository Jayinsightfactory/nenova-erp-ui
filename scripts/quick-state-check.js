#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request().query(`
    SELECT COUNT(*) cnt FROM StockHistory
     WHERE OrderYear='2026' AND OrderWeek='26-01'
       AND ISNULL(Descr,'') LIKE N'26-01잔량정리:%'`);
  const b = await pool.request().input('pk', sql.Int, 1283).query('SELECT Stock FROM Product WHERE ProdKey=@pk');
  const ps = await pool.request().input('pk', sql.Int, 1283).query(`
    SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
     WHERE ps.ProdKey=@pk AND sm.OrderYearWeek='20262601'`);
  console.log({ 잔량정리left: r.recordset[0].cnt, brightonLive: b.recordset[0]?.Stock, brightonPs: ps.recordset[0]?.Stock });
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
