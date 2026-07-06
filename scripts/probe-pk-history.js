#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const pks = process.argv.slice(2).map(Number).filter(Boolean);
const LIST = pks.length ? pks : [2179, 2565, 3164, 675, 181, 328];

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  for (const pk of LIST) {
    const name = await pool.request().input('pk', sql.Int, pk)
      .query('SELECT ProdName FROM Product WHERE ProdKey=@pk');
    console.log(`\n=== pk=${pk} ${name.recordset[0]?.ProdName?.slice(0, 50)} ===`);

    const ps = await pool.request().input('pk', sql.Int, pk).query(`
      SELECT sm.OrderYearWeek, ps.Stock FROM ProductStock ps
        JOIN StockMaster sm ON sm.StockKey=ps.StockKey
       WHERE ps.ProdKey=@pk AND sm.OrderYearWeek >= '20262401'
       ORDER BY sm.OrderYearWeek`);
    for (const r of ps.recordset) console.log(`  yw=${r.OrderYearWeek} ps=${r.Stock}`);

    const hist = await pool.request().input('pk', sql.Int, pk).query(`
      SELECT TOP 20 StockHistoryKey, OrderWeek, ChangeDtm, ChangeID, ChangeType,
             BeforeValue, AfterValue, Descr
        FROM StockHistory WHERE ProdKey=@pk AND OrderYear='2026'
       ORDER BY ChangeDtm DESC`);
    for (const h of hist.recordset) {
      console.log(
        `  hist wk=${h.OrderWeek} ${h.ChangeDtm?.toISOString?.()?.slice(0, 19)} ${h.ChangeID}`
        + ` b=${h.BeforeValue} a=${h.AfterValue} | ${String(h.Descr || '').slice(0, 70)}`,
      );
    }
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
