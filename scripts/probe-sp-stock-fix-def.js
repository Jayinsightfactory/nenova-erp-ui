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

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 60000 },
  });

  const names = ['usp_StockCalculation', 'usp_ShipmentFix', 'usp_ShipmentFixCancel'];
  for (const n of names) {
    const r = await pool.request().input('n', sql.NVarChar, n).query(`
      SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS def
    `);
    const def = r.recordset[0]?.def || '';
    console.log(`\n===== ${n} len=${def.length} =====`);
    const keys = ['DetailFix', 'ViewShipment', 'ProductStock', 'ns.Stock', 'OutQuantity', 'isFix', 'ROUND'];
    for (const k of keys) {
      const re = new RegExp(`.{0,80}${k}.{0,80}`, 'gi');
      const hits = def.match(re) || [];
      console.log(`-- ${k} (${hits.length})`);
      hits.slice(0, 8).forEach((h) => console.log('  ', h.replace(/\s+/g, ' ')));
    }
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
