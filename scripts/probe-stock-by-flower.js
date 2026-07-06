#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-02';
const YWS = '2026' + WEEK.replace('-', '');
const FLOWERS = ['장미', '수국', '카네이션', '알스트로메리아', '튤립', '백합', '거베라', '리시안셔스', '안스리움'];

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
  console.log(`=== ${WEEK} 꽃명별 재고 ===`);
  for (const f of FLOWERS) {
    const r = await pool.request().input('f', sql.NVarChar, `%${f}%`).input('yws', sql.NVarChar, YWS).input('wk', sql.NVarChar, WEEK).query(`
      SELECT COUNT(*) cnt,
             SUM(CASE WHEN ISNULL(cur.Stock,0)>0 THEN 1 ELSE 0 END) posPs,
             SUM(CASE WHEN ABS(ISNULL(p.Stock,0)-ISNULL(cur.Stock,0))>=1 THEN 1 ELSE 0 END) liveGap,
             SUM(CASE WHEN ISNULL(cur.Stock,0)>0 AND ISNULL(prev.Stock,0)=0 AND ISNULL(inc.inQty,0)=0 AND ISNULL(outq.outQty,0)=0 THEN 1 ELSE 0 END) ghost
        FROM Product p
        OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) cur(Stock)
        OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC) prev(Stock)
        OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear='2026' AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0) inc
        OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear='2026' AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0) outq
       WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL AND p.FlowerName LIKE @f`);
    const x = r.recordset[0];
    console.log(`${f}: 품목=${x.cnt} ps>0=${x.posPs} liveGap=${x.liveGap} ghost=${x.ghost}`);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
