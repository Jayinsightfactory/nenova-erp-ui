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
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const names = ['usp_ShipmentFix', 'usp_ShipmentFixCancel', 'usp_StockCalculation'];
  for (const name of names) {
    const r = await pool.request().query(`
      SELECT p.name, p.object_id,
             OBJECT_DEFINITION(p.object_id) AS def
        FROM sys.procedures p
       WHERE p.name = N'${name}'
    `);
    const row = r.recordset[0];
    if (!row) {
      console.log(`MISSING ${name}`);
      continue;
    }
    const def = row.def || '';
    const lines = def.split(/\r?\n/);
    console.log(`\n======== ${name} len=${def.length} lines=${lines.length} ========`);
    console.log('--- HEAD ---');
    console.log(lines.slice(0, 35).join('\n'));
    console.log('--- TAIL ---');
    console.log(lines.slice(-25).join('\n'));
    console.log('hasTran', /BEGIN\s+TRAN/i.test(def), 'hasCatch', /BEGIN\s+CATCH/i.test(def),
      'oResult', /@oResult/i.test(def), 'oMessage', /@oMessage/i.test(def));
  }
  const cols = await pool.request().query(`
    SELECT c.name FROM sys.columns c
     JOIN sys.views v ON v.object_id=c.object_id
     WHERE v.name='ViewShipment'
       AND c.name IN ('OrderYearWeek2','OrderYearWeek','DetailFix','CountryFlower','ProdKey','ProdName','OrderYear','OrderWeek')
     ORDER BY c.name
  `);
  console.log('\nViewShipment cols', cols.recordset.map((x) => x.name));
  const sm = await pool.request().query(`
    SELECT c.name FROM sys.columns c
     JOIN sys.tables t ON t.object_id=c.object_id
     WHERE t.name='StockMaster' AND c.name IN ('OrderYearWeek','OrderYear','OrderWeek','isFix','StockKey')
  `);
  console.log('StockMaster cols', sm.recordset.map((x) => x.name));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
