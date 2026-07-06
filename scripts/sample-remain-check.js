#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const pks = (process.argv[2] || '1283,447,1721,417,345,502,2997').split(',').map(Number);
const YWS = '20262601';
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  for (const pk of pks) {
    const r = await pool.request().input('pk', sql.Int, pk).input('yws', sql.NVarChar, YWS).query(`
      SELECT p.ProdName, ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps26,
        ISNULL(prev.Stock,0) prevPs, ISNULL(inc.inQty,0) whIn, ISNULL(outq.outQty,0) outFix
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) ps(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<'20262601' ORDER BY sm.OrderYearWeek DESC) prev(Stock)
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek='26-01' AND ISNULL(wm.isDeleted,0)=0) inc
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='26-01' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1) outq
      WHERE p.ProdKey=@pk`);
    const x = r.recordset[0];
    if (!x) continue;
    console.log(`pk=${pk} live=${x.live} ps26=${x.ps26} prev=${x.prevPs} in=${x.whIn} out=${x.outFix} | ${String(x.ProdName).slice(0, 50)}`);
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
