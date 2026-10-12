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
  const names = ['usp_ShipmentFix', 'usp_ShipmentFixCancel', 'usp_StockCalculation'];
  for (const n of names) {
    const r = await pool.request().query(
      `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.${n}')) AS def`,
    );
    const d = r.recordset[0].def || '';
    const enter = (d.match(/usp_NenovaStockWeekGateEnter/g) || []).length;
    const leave = (d.match(/usp_NenovaStockWeekGateLeave/g) || []).length;
    const rets = (d.match(/\breturn\s+(-1|0)\s*;/gi) || []).length;
    console.log(JSON.stringify({ n, len: d.length, enter, leave, rets }));
    const i = d.indexOf('usp_NenovaStockWeekGateEnter');
    console.log('enter-ctx', d.slice(Math.max(0, i - 160), i + 240).replace(/\s+/g, ' ').trim());
    const j = d.indexOf('usp_NenovaStockWeekGateLeave');
    console.log('leave-ctx', d.slice(Math.max(0, j - 80), j + 180).replace(/\s+/g, ' ').trim());
  }
  const g = await pool.request().query(
    'SELECT GateKey, Mode, OrderYear, OrderWeek, Action, LockedAt FROM dbo.NenovaStockWeekGate',
  );
  console.log('gate', g.recordset);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
