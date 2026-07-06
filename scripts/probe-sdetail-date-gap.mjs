#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const SDKEY = parseInt(process.argv[2] || '79257', 10);

function loadEnv() {
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}

async function main() {
  loadEnv();
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });

  const sd = await pool.request().input('sk', sql.Int, SDKEY).query(`
    SELECT sd.*, c.CustName, sm.OrderWeek, sm.isFix, p.ProdName, p.DisplayName
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON c.CustKey = sm.CustKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE sd.SdetailKey = @sk`);

  const dates = await pool.request().input('sk', sql.Int, SDKEY).query(`
    SELECT sdd.SdetailKey, sdd.ShipmentDtm, sdd.ShipmentQuantity, sdd.Amount, sdd.Vat, sdd.Descr
    FROM ShipmentDate sdd
    WHERE sdd.SdetailKey = @sk
    ORDER BY sdd.ShipmentDtm`);

  console.log('ShipmentDetail:', sd.recordset[0]);
  console.log('ShipmentDate rows:', dates.recordset);
  console.log('date Amount sum:', dates.recordset.reduce((a, r) => a + Number(r.Amount || 0), 0));
  console.log('gap:', Number(sd.recordset[0]?.Amount || 0) - dates.recordset.reduce((a, r) => a + Number(r.Amount || 0), 0));

  const hist = await pool.request().input('sk', sql.Int, SDKEY).query(`
    SELECT TOP 15 CreateDtm, Descr, BoxQuantity, BunchQuantity, OutQuantity, Cost, Amount, Vat
    FROM ShipmentHistory WHERE SdetailKey = @sk ORDER BY CreateDtm DESC`);
  console.log('ShipmentHistory:', hist.recordset);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
