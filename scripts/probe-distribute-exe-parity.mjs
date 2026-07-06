#!/usr/bin/env node
/** FormShipmentDistribution — exe SQL smoke probe */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';
import {
  sqlDistributeGetCustomerList,
  sqlDistributeGetPivotData,
} from '../lib/exeShipmentDistributionSql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const week = process.argv[2] || '';

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

let orderYearWeek = week;
if (!orderYearWeek) {
  const wk = await pool.request().query(
    `SELECT TOP 1 OrderYearWeek FROM ShipmentMaster WHERE isDeleted=0 ORDER BY CreateDtm DESC`
  );
  orderYearWeek = wk.recordset[0]?.OrderYearWeek || '';
}

console.log(`=== ShipmentDistribution exe probe — orderYearWeek=${orderYearWeek} ===\n`);

const custSql = sqlDistributeGetCustomerList();
const pivotSql = sqlDistributeGetPivotData();

const cust = await pool.request()
  .input('orderYearWeek', sql.NVarChar, orderYearWeek)
  .query(custSql);
const pivot = await pool.request()
  .input('orderYearWeek', sql.NVarChar, orderYearWeek)
  .query(pivotSql);

console.log(`customers: ${cust.recordset.length}`);
console.log(`pivot rows: ${pivot.recordset.length}`);
await pool.close();
process.exit(0);
