#!/usr/bin/env node
/**
 * 견적 차감(Estimate) 행 비고 정리 — nenova.exe 는 Estimate.Descr 를 그대로 표시
 * Usage:
 *   node scripts/cleanup-estimate-deduction-descr.mjs --week=26-02
 *   node scripts/cleanup-estimate-deduction-descr.mjs --week=26 --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import { sanitizeDescrTextForPrint } from '../lib/estimateInvariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const APPLY = process.argv.includes('--apply');
const weekArg = process.argv.find((a) => a.startsWith('--week='));
const WEEK = weekArg ? weekArg.slice('--week='.length) : '26';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  const r = await pool.request()
    .input('week', sql.NVarChar, WEEK.includes('%') ? WEEK : `${WEEK}%`)
    .query(`
    SELECT e.EstimateKey, sm.OrderWeek, c.CustName, p.ProdName, e.EstimateType,
           ISNULL(e.Descr,'') AS Descr
      FROM Estimate e
      JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN Product p ON p.ProdKey = e.ProdKey
     WHERE ISNULL(sm.isDeleted,0)=0
       AND sm.OrderWeek LIKE @week
       AND ISNULL(e.EstimateType,'') <> N'정상출고'
       AND ISNULL(e.Descr,'') <> ''
     ORDER BY sm.OrderWeek, c.CustName, p.ProdName`);

  const targets = [];
  for (const row of r.recordset) {
    const before = String(row.Descr || '');
    const after = sanitizeDescrTextForPrint(before);
    if (before !== after) targets.push({ ...row, before, after });
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | week=${WEEK}% | candidates=${targets.length}\n`);
  for (const row of targets.slice(0, 25)) {
    console.log(
      `ek=${row.EstimateKey} ${row.OrderWeek} ${row.EstimateType} | ${String(row.ProdName).slice(0, 40)}`
      + `\n  before: ${row.before.slice(0, 120)}`
      + `\n  after:  ${row.after.slice(0, 120) || '(empty)'}`,
    );
  }
  if (targets.length > 25) console.log(`... +${targets.length - 25} more`);

  if (!APPLY) {
    console.log('\nAdd --apply to update Estimate.Descr');
    await pool.close();
    return;
  }

  for (const row of targets) {
    await pool.request()
      .input('ek', sql.Int, row.EstimateKey)
      .input('descr', sql.NVarChar, row.after)
      .query('UPDATE Estimate SET Descr = @descr WHERE EstimateKey = @ek');
  }
  console.log(`\nDone: updated=${targets.length}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
