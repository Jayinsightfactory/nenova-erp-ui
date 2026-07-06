#!/usr/bin/env node
const fs = require('fs');
const sql = require('mssql');
fs.readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const pks = process.argv.slice(2).map(Number).filter(Boolean);
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  for (const pk of pks) {
    const r = await pool.request().input('pk', pk).input('yws', '20262601').input('wk', '26-01').input('yr', '2026')
      .query(`
      SELECT p.ProdKey, p.ProdName, ISNULL(p.Stock,0) live, ISNULL(cur.Stock,0) ps, ISNULL(prev.Stock,0) prevPs,
             ISNULL(inc.inQty,0) inQty, ISNULL(out26.outQty,0) outQty, ISNULL(adj26.adjQty,0) adj26
        FROM Product p
        OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) cur(Stock)
        OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC) prev(Stock)
        OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0) inc
        OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0) out26
        OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj26
       WHERE p.ProdKey=@pk`);
    const x = r.recordset[0];
    const exp = Number(x.prevPs) + Number(x.inQty) - Number(x.outQty) + Number(x.adj26);
    const remain = exp;
    const prodRem = Number(x.live) + Number(x.inQty) - Number(x.outQty);
    console.log(`pk=${pk} ps=${x.ps} exp=${exp} remain=${remain} prodRem=${prodRem} prev=${x.prevPs} in=${x.inQty} out=${x.outQty} adj=${x.adj26} live=${x.live}`);
    console.log(`  ${String(x.ProdName).slice(0, 60)}`);
  }
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
