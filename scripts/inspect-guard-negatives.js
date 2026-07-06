#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const YEAR = '2026';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const guard = require('child_process').execSync(`node "${path.join(__dirname, 'probe-exe-negative-guard.js')}" ${WEEK}`, { encoding: 'utf8' });
  const pks = [...guard.matchAll(/pk=(\d+)/g)].map((m) => Number(m[1]));
  const uniq = [...new Set(pks)];

  for (const pk of uniq) {
    const d = await pool.request().input('pk', sql.Int, pk).input('wk', sql.NVarChar, WEEK).input('yr', sql.NVarChar, YEAR)
      .query(`
      SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live,
        ISNULL(ps26.Stock,0) ps26,
        ISNULL(inc.inQty,0) whIn,
        ISNULL(adj.adjQty,0) adj26,
        ISNULL(outq.outQty,0) out26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yr+REPLACE(@wk,'-','')
      ) ps26(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd
        JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
         WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0
      ) inc
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
      ) outq
      WHERE p.ProdKey=@pk`);

    const hist = await pool.request().input('pk', sql.Int, pk).input('wk', sql.NVarChar, WEEK).input('yr', sql.NVarChar, YEAR)
      .query(`SELECT TOP 8 sh.StockHistoryKey, sh.BeforeValue, sh.AfterValue, sh.Descr, sh.ChangeDtm FROM StockHistory sh
        WHERE sh.ProdKey=@pk AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL} ORDER BY sh.ChangeDtm DESC`);

    const row = d.recordset[0];
    console.log(`\npk=${pk} live=${row.live} ps26=${row.ps26} whIn=${row.whIn} adj26=${row.adj26} out26=${row.out26}`);
    console.log(`  ${row.ProdName}`);
    for (const h of hist.recordset) {
      console.log(`  hist ${h.BeforeValue}→${h.AfterValue} ${String(h.Descr||'').slice(0,40)}`);
    }
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
