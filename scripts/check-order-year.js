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
  for (const w of ['25-01', '25-02', '26-01']) {
    const r = await pool.request().input('wk', sql.NVarChar, w)
      .query(`SELECT TOP 1 OrderYear FROM ShipmentMaster WHERE OrderWeek=@wk AND isDeleted=0`);
    console.log(w, 'OrderYear', r.recordset[0]?.OrderYear);
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
