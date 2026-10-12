#!/usr/bin/env node
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
const outDir = process.argv[2] || path.join(__dirname, '..', 'docs', 'migrations');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 60000 },
  });
  for (const n of ['usp_ShipmentFix', 'usp_ShipmentFixCancel', 'usp_StockCalculation']) {
    const r = await pool.request().input('n', sql.NVarChar, n).query(`SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS def`);
    const def = r.recordset[0]?.def || '';
    const file = path.join(outDir, `backup_${n}_2026-08-20.sql`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, def, 'utf8');
    console.log(n, 'len', def.length, '->', file);
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
