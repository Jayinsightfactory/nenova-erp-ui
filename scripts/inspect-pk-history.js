#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const pk = Number(process.argv[2] || 2997);
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request().input('pk', sql.Int, pk).query(`
    SELECT StockHistoryKey, OrderWeek, BeforeValue, AfterValue, Descr, ChangeDtm
      FROM StockHistory WHERE ProdKey=@pk AND OrderYear='2026' AND OrderWeek='26-01'
      ORDER BY ChangeDtm`);
  const p = await pool.request().input('pk', sql.Int, pk)
    .query(`SELECT Stock FROM Product WHERE ProdKey=@pk`);
  console.log('live', p.recordset[0]?.Stock);
  r.recordset.forEach((h) => console.log(h));
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
