#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const envPath = [
  path.join(__dirname, '..', '.env.local'),
  'C:/Users/USER/nenova-erp-ui/.env.local',
].find((p) => fs.existsSync(p));
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const triggers = await pool.request().query(`
    SELECT name, is_disabled, OBJECT_DEFINITION(object_id) AS def
      FROM sys.triggers
     WHERE parent_id = OBJECT_ID('ShipmentDetail')`);
  for (const t of triggers.recordset) {
    console.log('TRIGGER', t.name, 'disabled=', t.is_disabled);
    console.log(String(t.def || '').slice(0, 1800));
    console.log('---');
  }

  const sd = await pool.request().query(`
    SELECT TOP 15 sd.SdetailKey, sm.OrderYear, sm.OrderWeek, c.CustName,
           LEFT(ISNULL(sd.Descr,N''), 220) AS Descr
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
     WHERE ISNULL(sd.Descr,N'') LIKE N'%SqlClient%'
        OR ISNULL(sd.Descr,N'') LIKE N'%Data Provider%'
        OR ISNULL(sd.Descr,N'') LIKE N'%→%'
     ORDER BY sd.SdetailKey DESC`);
  console.log('sd_polluted', sd.recordset.length);
  for (const r of sd.recordset) console.log(JSON.stringify(r));

  const sdd = await pool.request().query(`
    SELECT TOP 15 sdd.SdateKey, sm.OrderYear, sm.OrderWeek, c.CustName,
           LEFT(ISNULL(sdd.Descr,N''), 220) AS Descr
      FROM ShipmentDate sdd
      JOIN ShipmentDetail sd ON sd.SdetailKey = sdd.SdetailKey
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
     WHERE ISNULL(sdd.Descr,N'') LIKE N'%SqlClient%'
        OR ISNULL(sdd.Descr,N'') LIKE N'%Data Provider%'
        OR ISNULL(sdd.Descr,N'') LIKE N'%>%'
        OR ISNULL(sdd.Descr,N'') LIKE N'%→%'
     ORDER BY sdd.SdateKey DESC`);
  console.log('sdd_polluted', sdd.recordset.length);
  for (const r of sdd.recordset) console.log(JSON.stringify(r));

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
