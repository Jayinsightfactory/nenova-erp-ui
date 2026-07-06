#!/usr/bin/env node
/** FormSalesManagerView — exe SQL row count probe (DB 필요) */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';
import { sqlSalesManagerViewGetData } from '../lib/exeSalesManagerViewSql.js';
import { resolveOrderYearWeekFromBaseYmd } from '../lib/exeParity/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const searchDate = process.argv[2] || new Date().toISOString().slice(0, 10);

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

async function dbQuery(text, params) {
  const req = pool.request();
  for (const [k, v] of Object.entries(params || {})) {
    req.input(k, v.type, v.value);
  }
  return req.query(text);
}

const base = new Date(searchDate);
const week1 = await resolveOrderYearWeekFromBaseYmd(dbQuery, sql, base);
const prev = new Date(base);
prev.setDate(prev.getDate() - 7);
const week2 = await resolveOrderYearWeekFromBaseYmd(dbQuery, sql, prev);
const exeSql = sqlSalesManagerViewGetData({});

console.log(`=== 담당자실적 exe probe — searchDate=${searchDate} week1=${week1} week2=${week2} ===\n`);

const res = await pool.request()
  .input('week1', sql.NVarChar, week1)
  .input('week2', sql.NVarChar, week2)
  .query(exeSql);

const rows = res.recordset || [];
const total1 = rows.reduce((a, r) => a + (Number(r.Amount1) || 0), 0);
const total2 = rows.reduce((a, r) => a + (Number(r.Amount2) || 0), 0);
console.log(`rows: ${rows.length}`);
console.log(`Amount1 합계: ${total1.toLocaleString()}`);
console.log(`Amount2 합계: ${total2.toLocaleString()}`);
console.log(rows.slice(0, 5).map((r) => `  ${r.CustArea} | ${r.BusinessManager} | ${r.CustName} | ${r.Amount1}`).join('\n') || '(empty)');
await pool.close();
process.exit(0);
