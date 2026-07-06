#!/usr/bin/env node
/** 견적 API exe parity vs legacy Cost×qty 마스터 합계 비교 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';
import {
  activeWdKrToExeSqlIn,
  buildEstimateOrderYearWeek,
  sqlEstimateGetData,
} from '../lib/exeEstimateViewSql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] || '26';

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
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
});

const parentWeek = PW.split('-')[0];
const yrRow = await pool.request()
  .input('pw', sql.NVarChar, parentWeek)
  .query(`SELECT TOP 1 OrderYear, OrderYearWeek FROM ShipmentMaster
          WHERE isDeleted=0 AND LEFT(OrderWeek, CHARINDEX('-', OrderWeek + N'-') - 1)=@pw
          ORDER BY CreateDtm DESC`);
const orderYear = yrRow.recordset[0]?.OrderYear || new Date().getFullYear();
const orderYearWeek = String(yrRow.recordset[0]?.OrderYearWeek || buildEstimateOrderYearWeek(orderYear, parentWeek));
const wdIn = activeWdKrToExeSqlIn(null);

console.log(`=== 견적 exe parity probe — parentWeek=${parentWeek} orderYearWeek=${orderYearWeek} ===\n`);

const exeSql = sqlEstimateGetData({ orderYearWeek, custKey: null, weekDayIn: wdIn });
const exeRes = await pool.request()
  .input('orderYearWeek', sql.NVarChar, orderYearWeek)
  .query(exeSql);

const legacyRes = await pool.request()
  .input('parentWeek', sql.NVarChar, parentWeek)
  .query(`
    SELECT sm.CustKey, c.CustName,
           SUM(ISNULL(sa.shipAmt, 0) + ISNULL(ea.estAmt, 0)) AS totalAmount
      FROM ShipmentMaster sm
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      OUTER APPLY (
        SELECT SUM(ISNULL(p2.Cost,0)
          * CASE WHEN sd2.BunchQuantity > 0 THEN sd2.BunchQuantity
                 WHEN sd2.SteamQuantity > 0 THEN sd2.SteamQuantity
                 ELSE sd2.BoxQuantity END
        ) AS shipAmt
        FROM ShipmentDetail sd2
        LEFT JOIN Product p2 ON sd2.ProdKey = p2.ProdKey
        WHERE sd2.ShipmentKey = sm.ShipmentKey
      ) sa
      OUTER APPLY (
        SELECT SUM(e2.Amount + e2.Vat) AS estAmt FROM Estimate e2 WHERE e2.ShipmentKey = sm.ShipmentKey
      ) ea
     WHERE sm.isDeleted = 0 AND sm.isFix = 1
       AND LEFT(sm.OrderWeek, LEN(@parentWeek)) = @parentWeek
     GROUP BY sm.CustKey, c.CustName
     ORDER BY c.CustName`);

const exeMap = Object.fromEntries(exeRes.recordset.map((r) => [r.CustKey, r]));
const legacyMap = Object.fromEntries(legacyRes.recordset.map((r) => [r.CustKey, r]));

const allKeys = new Set([...Object.keys(exeMap), ...Object.keys(legacyMap)]);
let exeTotal = 0;
let legacyTotal = 0;
const diffs = [];

for (const ck of allKeys) {
  const exe = Number(exeMap[ck]?.totalAmount || exeMap[ck]?.Amount || 0);
  const leg = Number(legacyMap[ck]?.totalAmount || 0);
  exeTotal += exe;
  legacyTotal += leg;
  const gap = exe - leg;
  if (Math.abs(gap) > 1) {
    diffs.push({
      CustKey: ck,
      CustName: exeMap[ck]?.CustName || legacyMap[ck]?.CustName,
      exe,
      legacy: leg,
      gap,
    });
  }
}

console.log(`거래처 수 — exe: ${exeRes.recordset.length}, legacy: ${legacyRes.recordset.length}`);
console.log(`합계 — exe: ${exeTotal.toLocaleString()}, legacy: ${legacyTotal.toLocaleString()}, gap: ${(exeTotal - legacyTotal).toLocaleString()}`);
console.log(`차이 >1원 거래처: ${diffs.length}건\n`);

diffs.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
for (const d of diffs.slice(0, 20)) {
  console.log(`  ${d.CustName} (${d.CustKey}): exe=${d.exe.toLocaleString()} legacy=${d.legacy.toLocaleString()} gap=${d.gap.toLocaleString()}`);
}

await pool.close();
process.exit(0);
