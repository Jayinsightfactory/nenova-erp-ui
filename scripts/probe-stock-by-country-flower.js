#!/usr/bin/env node
/** 차수별 국가·꽃명 재고 이상 스캔 (psGap / liveGap / 유령패턴) */
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
const MIN_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 1);
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

function bucket(row) {
  const country = String(row.CounName || row.CountryFlower || '(미지정)').trim();
  const flower = String(row.FlowerName || '(미지정)').trim();
  return `${country} / ${flower}`;
}

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
    .query(`
    SELECT p.ProdKey, p.ProdName, p.CounName, p.CountryFlower, p.FlowerName,
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
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL`);

  const byBucket = new Map();
  const ghosts = [];
  let psGapTotal = 0;
  let liveGapTotal = 0;
  let negPs = 0;

  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const psGap = Number(row.ps) - expected;
    const liveGap = Number(row.live) - Number(row.ps);
    const isGhost = Number(row.ps) > 0 && Number(row.prevPs) === 0 && Number(row.inQty) === 0
      && Number(row.outQty) === 0 && Math.abs(Number(row.adj26)) < 0.01;

    if (Number(row.ps) < 0) negPs += 1;
    if (Math.abs(psGap) >= MIN_GAP) psGapTotal += 1;
    if (Math.abs(liveGap) >= MIN_GAP) liveGapTotal += 1;
    if (isGhost) ghosts.push(row);

    const key = bucket(row);
    if (!byBucket.has(key)) {
      byBucket.set(key, { psGap: 0, liveGap: 0, ghost: 0, posPs: 0, sumPs: 0 });
    }
    const b = byBucket.get(key);
    if (Number(row.ps) > 0) { b.posPs += 1; b.sumPs += Number(row.ps); }
    if (Math.abs(psGap) >= MIN_GAP) b.psGap += 1;
    if (Math.abs(liveGap) >= MIN_GAP) b.liveGap += 1;
    if (isGhost) b.ghost += 1;
  }

  console.log(`=== ${WEEK} 재고 점검 (gap>=${MIN_GAP}) ===`);
  console.log(`scanned=${r.recordset.length} psGap=${psGapTotal} liveGap=${liveGapTotal} ghost=${ghosts.length} negPs=${negPs}\n`);

  const sorted = [...byBucket.entries()]
    .filter(([, v]) => v.psGap > 0 || v.liveGap > 0 || v.ghost > 0)
    .sort((a, b) => (b[1].psGap + b[1].liveGap + b[1].ghost) - (a[1].psGap + a[1].liveGap + a[1].ghost));

  if (!sorted.length) {
    console.log('국가/꽃명별 이상 없음.');
  } else {
    console.log('국가/꽃명별 이상 요약:');
    for (const [key, v] of sorted.slice(0, 30)) {
      console.log(`  ${key}: psGap=${v.psGap} liveGap=${v.liveGap} ghost=${v.ghost} posPs=${v.posPs}`);
    }
  }

  if (ghosts.length) {
    console.log(`\n=== 유령재고 (prev=0, 입출고·조정 없음, ps>0): ${ghosts.length} ===`);
    for (const row of ghosts.slice(0, 20)) {
      console.log(`pk=${row.ProdKey} ps=${row.ps} live=${row.live} | ${bucket(row)} | ${String(row.ProdName).slice(0, 50)}`);
    }
    if (ghosts.length > 20) console.log(`... +${ghosts.length - 20} more`);
  }

  const liveOnly = [];
  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const psGap = Number(row.ps) - expected;
    const liveGap = Number(row.live) - Number(row.ps);
    if (Math.abs(psGap) < MIN_GAP && Math.abs(liveGap) >= MIN_GAP) {
      liveOnly.push({ ...row, liveGap });
    }
  }
  if (liveOnly.length) {
    console.log(`\n=== live≠ps (차수잔량 정상, 실시간만 차이): ${liveOnly.length} ===`);
    for (const row of liveOnly.sort((a, b) => Math.abs(b.liveGap) - Math.abs(a.liveGap)).slice(0, 15)) {
      console.log(
        `pk=${row.ProdKey} ps=${row.ps} live=${row.live} gap=${row.liveGap.toFixed(1)} adj=${row.adj26}`
        + ` | ${bucket(row)} | ${String(row.ProdName).slice(0, 45)}`,
      );
    }
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
