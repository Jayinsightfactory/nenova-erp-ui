#!/usr/bin/env node
/** 26-01 (또는 지정 차수) 국가별 재고 이상 스캔 — live vs ProductStock gap */
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
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const YWS = YEAR + WEEK.replace('-', '');
const MIN_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 1);
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

  const countryFilter = COUNTRY
    ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
    : '';

  const r = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, p.CounName, p.CountryFlower,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(prev.Stock,0) AS prevPs,
           ISNULL(inc.inQty,0) AS inQty,
           ISNULL(out26.outQty,0) AS outQty,
           ISNULL(adj26.adjQty,0) AS adj26,
           ISNULL(web.cnt,0) AS webCnt,
           ISNULL(sus.cnt,0) AS susCnt
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
         ORDER BY ps.StockKey DESC
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
      OUTER APPLY (
        SELECT COUNT(*) cnt FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND ISNULL(sh.Descr,'') LIKE N'%웹복구%'
      ) web
      OUTER APPLY (
        SELECT COUNT(*) cnt, SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) sumDelta
          FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.ChangeDtm >= '2026-06-23'
           AND sh.ChangeType = N'재고조정'
           AND ISNULL(sh.Descr,'') NOT LIKE N'%웹복구%'
           AND ABS(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) >= 1
      ) sus
     WHERE ISNULL(p.isDeleted,0)=0
       AND cur.Stock IS NOT NULL
       ${countryFilter}
     ORDER BY p.CounName, p.ProdName`);

  const issues = [];
  for (const row of r.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const psGap = Number(row.ps) - expected;
    const livePsGap = Number(row.live) - Number(row.ps);
    if (Math.abs(psGap) >= MIN_GAP || Math.abs(livePsGap) >= MIN_GAP) {
      issues.push({ ...row, expected, psGap, livePsGap });
    }
  }

  const label = COUNTRY || '전체';
  console.log(`=== ${WEEK} ${label} scanned=${r.recordset.length} issues(gap>=${MIN_GAP})=${issues.length} ===\n`);

  const byType = { psGap: 0, liveGap: 0, both: 0 };
  for (const row of issues) {
    const psBad = Math.abs(row.psGap) >= MIN_GAP;
    const liveBad = Math.abs(row.livePsGap) >= MIN_GAP;
    if (psBad && liveBad) byType.both += 1;
    else if (psBad) byType.psGap += 1;
    else byType.liveGap += 1;

    console.log(
      `pk=${row.ProdKey} ps=${Number(row.ps).toFixed(1)} exp=${row.expected.toFixed(1)} psGap=${row.psGap.toFixed(1)}`
      + ` | live=${Number(row.live).toFixed(1)} live-ps=${row.livePsGap.toFixed(1)}`
      + ` prev=${Number(row.prevPs).toFixed(1)} in=${Number(row.inQty).toFixed(1)} out=${Number(row.outQty).toFixed(1)} adj26=${Number(row.adj26).toFixed(1)}`
      + ` web=${row.webCnt} sus=${row.susCnt}`
      + `\n  ${row.ProdName}`,
    );
  }
  console.log(`\npsGap only=${byType.psGap} liveGap only=${byType.liveGap} both=${byType.both}`);

  // recent suspicious StockHistory for country
  if (COUNTRY) {
    const hist = await pool.request()
      .input('wk', sql.NVarChar, WEEK)
      .input('yr', sql.NVarChar, YEAR)
      .input('c', sql.NVarChar, `%${COUNTRY}%`)
      .query(`
      SELECT TOP 40 sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.OrderWeek,
             sh.ChangeDtm, sh.ChangeID, sh.BeforeValue, sh.AfterValue,
             ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS delta, sh.Descr
        FROM StockHistory sh
        JOIN Product p ON p.ProdKey=sh.ProdKey
       WHERE (p.CounName LIKE @c OR p.CountryFlower LIKE @c)
         AND sh.ChangeDtm >= '2026-06-20'
         AND ${MANUAL}
       ORDER BY sh.ChangeDtm DESC`);
    console.log(`\n=== ${COUNTRY} recent manual StockHistory (since 6/20): ${hist.recordset.length} ===`);
    for (const h of hist.recordset) {
      console.log(
        `shk=${h.StockHistoryKey} pk=${h.ProdKey} wk=${h.OrderWeek} ${h.ChangeDtm?.toISOString?.()?.slice(0, 19)}`
        + ` Δ=${Number(h.delta).toFixed(2)} by=${h.ChangeID} | ${String(h.Descr || '').slice(0, 50)}`
        + `\n  ${h.ProdName?.slice(0, 50)}`,
      );
    }
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
