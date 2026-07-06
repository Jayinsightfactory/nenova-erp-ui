#!/usr/bin/env node
/** 25차(25-01/25-02) 전국가 psGap·ghost 요약 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEKS = process.argv.slice(2).filter((a) => /^\d{2}-\d{2}$/.test(a));
const LIST = WEEKS.length ? WEEKS : ['25-01', '25-02'];
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function scanWeek(pool, WEEK) {
  const YWS = '2026' + WEEK.replace('-', '');
  const r = await pool.request().input('yws', sql.NVarChar, YWS).input('wk', sql.NVarChar, WEEK).input('yr', sql.NVarChar, '2026').query(`
    SELECT p.ProdKey, p.ProdName, p.CounName, p.FlowerName,
           ISNULL(p.Stock,0) live, ISNULL(cur.Stock,0) ps,
           ISNULL(prev.Stock,0) prevPs, ISNULL(inc.inQty,0) inQty,
           ISNULL(outq.outQty,0) outQty, ISNULL(adj.adjQty,0) adj26
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) cur(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC) prev(Stock)
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0) inc
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0) outq
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL`);

  const byCountry = new Map();
  let psGap = 0, ghost = 0, liveGap = 0;
  const ghostRows = [], psGapRows = [];

  for (const row of r.recordset) {
    const exp = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const pg = Number(row.ps) - exp;
    const lg = Number(row.live) - Number(row.ps);
    const isGhost = Number(row.ps) > 0 && Number(row.prevPs) === 0 && Number(row.inQty) === 0 && Number(row.outQty) === 0 && Math.abs(Number(row.adj26)) < 0.01;
    const c = String(row.CounName || row.CountryFlower || '?').trim();
    if (!byCountry.has(c)) byCountry.set(c, { psGap: 0, ghost: 0, liveGap: 0 });
    const b = byCountry.get(c);
    if (Math.abs(pg) >= 1) { psGap++; b.psGap++; psGapRows.push({ ...row, exp, pg }); }
    if (isGhost) { ghost++; b.ghost++; ghostRows.push(row); }
    if (Math.abs(lg) >= 1) { liveGap++; b.liveGap++; }
  }

  return { WEEK, scanned: r.recordset.length, psGap, ghost, liveGap, byCountry, ghostRows, psGapRows };
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
  for (const wk of LIST) {
    const s = await scanWeek(pool, wk);
    console.log(`\n======== ${wk} ========`);
    console.log(`scanned=${s.scanned} psGap=${s.psGap} ghost=${s.ghost} liveGap=${s.liveGap}`);
    console.log('\n국가별:');
    [...s.byCountry.entries()].sort((a, b) => (b[1].psGap + b[1].ghost) - (a[1].psGap + a[1].ghost))
      .filter(([, v]) => v.psGap || v.ghost || v.liveGap)
      .forEach(([c, v]) => console.log(`  ${c}: psGap=${v.psGap} ghost=${v.ghost} liveGap=${v.liveGap}`));
    if (s.ghostRows.length) {
      console.log(`\n유령재고 ${s.ghostRows.length}건:`);
      s.ghostRows.forEach((row) => console.log(`  pk=${row.ProdKey} ps=${row.ps} live=${row.live} | ${row.CounName}/${row.FlowerName} | ${String(row.ProdName).slice(0, 50)}`));
    }
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
