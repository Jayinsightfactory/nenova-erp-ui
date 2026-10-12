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
const sql = require(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mssql'))
  ? 'mssql'
  : 'C:/Users/USER/nenova-erp-ui/node_modules/mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const procs = await pool.request().query(`
    SELECT name FROM sys.procedures
     WHERE name LIKE N'%Gate%' OR name LIKE N'%StockWeek%'
     ORDER BY name`);
  const tables = await pool.request().query(`
    SELECT name FROM sys.tables
     WHERE name LIKE N'%Gate%' OR name LIKE N'%StockWeek%'
     ORDER BY name`);
  const cols = await pool.request().query(`
    SELECT c.name
      FROM sys.columns c
      JOIN sys.views v ON v.object_id = c.object_id
     WHERE v.name = N'ViewShipment'
       AND c.name IN (N'DetailFix', N'DetailFix', N'CountryFlower', N'CountryFlower',
                      N'OrderYearWeek2', N'OrderYearWeek2', N'ProdName', N'ProdName')
     ORDER BY c.name`);
  const sm = await pool.request().query(`
    SELECT name FROM sys.tables WHERE name IN (N'StockMaster', N'StockMaster')`);
  console.log('procs', procs.recordset.map((r) => r.name));
  console.log('tables', tables.recordset.map((r) => r.name));
  console.log('view-cols', cols.recordset.map((r) => r.name));
  console.log('stock-tables', sm.recordset.map((r) => r.name));
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
