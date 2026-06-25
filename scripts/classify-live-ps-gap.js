#!/usr/bin/env node
/** 26-01 네덜란드 등 — live(Product.Stock) vs ProductStock 잔량 불일치 분류 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '네덜란드';
const YWS = YEAR + WEEK.replace('-', '');
const MIN_LIVE_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 5);
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

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
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .input('c', sql.NVarChar, `%${COUNTRY}%`)
    .query(`
    SELECT p.ProdKey, p.ProdName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(prev.Stock,0) AS prevPs,
           ISNULL(inc.inQty,0) AS inQty,
           ISNULL(out26.outQty,0) AS outQty,
           ISNULL(adj26.adjQty,0) AS adj26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) cur(Stock)
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek < @yws
         ORDER BY sm.OrderYearWeek DESC
      ) prev(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk
      ) inc
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk
      ) out26
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj26
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL
       AND (p.CounName LIKE @c OR p.CountryFlower LIKE @c)
     ORDER BY ABS(ISNULL(p.Stock,0)-ISNULL(cur.Stock,0)) DESC`);

  const phantomPs = []; // ps 높은데 live 낮음 — 전주 이월 유령
  const liveBloat = []; // live 높은데 ps 낮음
  const skipManual = [];

  for (const row of r.recordset) {
    const live = Number(row.live);
    const ps = Number(row.ps);
    const gap = live - ps;
    if (Math.abs(gap) < MIN_LIVE_GAP) continue;
    if (Math.abs(Number(row.adj26)) >= 0.01) {
      skipManual.push({ ...row, gap });
      continue;
    }
    if (ps > live && ps >= MIN_LIVE_GAP) phantomPs.push({ ...row, gap });
    else if (live > ps) liveBloat.push({ ...row, gap });
  }

  console.log(`=== ${WEEK} ${COUNTRY} live vs ProductStock (min gap ${MIN_LIVE_GAP}) ===`);
  console.log(`phantomPs (ps>live, no adj26): ${phantomPs.length}`);
  console.log(`liveBloat (live>ps, no adj26): ${liveBloat.length}`);
  console.log(`skip (has 26-01 manual adj): ${skipManual.length}\n`);

  const show = (title, arr, n = 30) => {
    console.log(`--- ${title} (top ${Math.min(n, arr.length)}) ---`);
    for (const row of arr.slice(0, n)) {
      console.log(
        `pk=${row.ProdKey} ps=${Number(row.ps).toFixed(1)} live=${Number(row.live).toFixed(1)} gap=${row.gap.toFixed(1)}`
        + ` prev=${Number(row.prevPs).toFixed(1)} in=${Number(row.inQty).toFixed(1)} out=${Number(row.outQty).toFixed(1)}`
        + ` | ${String(row.ProdName).slice(0, 50)}`,
      );
    }
    if (arr.length > n) console.log(`... +${arr.length - n} more`);
    console.log('');
  };

  show('PHANTOM_PS — 차수잔량(ps)만 남음', phantomPs);
  show('LIVE_BLOAT — 실시간(live)만 과다', liveBloat);
  show('SKIP — 26-1 수동조정 있음', skipManual, 10);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
