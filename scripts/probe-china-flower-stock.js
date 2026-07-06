#!/usr/bin/env node
/** 중국 + 꽃명(장미/기타 등) 재고 점검 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-02';
const YEAR = '2026';
const YWS = YEAR + WEEK.replace('-', '');
const FLOWER = process.argv.find((a) => a.startsWith('--flower='))?.split('=')[1] || '장미';
const MIN_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 1);
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;
const CN = `AND (p.CounName LIKE N'%중국%' OR p.CountryFlower LIKE N'%중국%')`;

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  const flowerFilter = FLOWER === '기타'
    ? `AND (p.FlowerName = N'기타' OR p.FlowerName LIKE N'%기타%')`
    : `AND p.FlowerName LIKE N'%${FLOWER.replace(/'/g, "''")}%'`;

  const r = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(prev.Stock,0) AS prevPs,
           ISNULL(inc.inQty,0) AS inQty,
           ISNULL(outq.outQty,0) AS outQty,
           ISNULL(adj.adjQty,0) AS adj26
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
      ) outq
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL
       ${CN} ${flowerFilter}
     ORDER BY ABS(ISNULL(p.Stock,0)-ISNULL(cur.Stock,0)) DESC, ISNULL(cur.Stock,0) DESC`);

  let psGap = 0;
  let liveGap = 0;
  let ghost = 0;
  let posPs = 0;
  const issues = [];

  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const pg = Number(row.ps) - expected;
    const lg = Number(row.live) - Number(row.ps);
    const isGhost = Number(row.ps) > 0 && Number(row.prevPs) === 0 && Number(row.inQty) === 0
      && Number(row.outQty) === 0 && Math.abs(Number(row.adj26)) < 0.01;
    if (Number(row.ps) > 0) posPs += 1;
    if (isGhost) ghost += 1;
    if (Math.abs(pg) >= MIN_GAP) psGap += 1;
    if (Math.abs(lg) >= MIN_GAP) liveGap += 1;
    if (Math.abs(pg) >= MIN_GAP || Math.abs(lg) >= MIN_GAP || isGhost) {
      issues.push({ ...row, expected, pg, lg, isGhost });
    }
  }

  console.log(`=== 중국 / ${FLOWER} | ${WEEK} ===`);
  console.log(`scanned=${r.recordset.length} posPs=${posPs} psGap=${psGap} liveGap=${liveGap} ghost=${ghost}\n`);

  if (!issues.length) {
    console.log('이상 없음.');
  } else {
    for (const row of issues) {
      console.log(
        `pk=${row.ProdKey} ps=${row.ps} exp=${row.expected.toFixed(1)} psGap=${row.pg.toFixed(1)}`
        + ` live=${row.live} liveGap=${row.lg.toFixed(1)}`
        + ` prev=${row.prevPs} in=${row.inQty} out=${row.outQty} adj=${row.adj26}`
        + `${row.isGhost ? ' [GHOST]' : ''}`
        + `\n  ${row.ProdName}`,
      );
    }
  }

  const pos = r.recordset.filter((row) => Number(row.ps) > 0 || Number(row.live) > 0);
  if (pos.length && !issues.length) {
    console.log(`\n양수 재고 품목 ${pos.length}건 (공식·live 정상):`);
    for (const row of pos.slice(0, 15)) {
      console.log(`  pk=${row.ProdKey} ps=${row.ps} live=${row.live} | ${String(row.ProdName).slice(0, 55)}`);
    }
    if (pos.length > 15) console.log(`  ... +${pos.length - 15} more`);
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
