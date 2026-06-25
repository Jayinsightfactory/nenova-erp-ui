#!/usr/bin/env node
/**
 * 웹복구( repair-negative-product-stock ) 로 생긴 재고 조사
 * Usage:
 *   node scripts/probe-web-recovery-stock.js
 *   node scripts/probe-web-recovery-stock.js 26-01
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const TARGET_WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const YEAR = '2026';
const YWS = YEAR + TARGET_WEEK.replace('-', '');
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

  const webRecovery = await pool.request().query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName, p.CountryFlower,
           sh.OrderYear, sh.OrderWeek, sh.ChangeDtm, sh.ChangeID, sh.ChangeType,
           sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS delta,
           sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE ISNULL(sh.Descr,'') LIKE N'%웹복구%'
        OR (sh.ChangeID = N'nenovaSS3' AND sh.ChangeType = N'재고조정'
            AND ISNULL(sh.Descr,'') LIKE N'%Product.Stock%')
     ORDER BY sh.ChangeDtm DESC, sh.ProdKey`);

  console.log(`=== 웹복구 StockHistory: ${webRecovery.recordset.length}건 ===\n`);
  const byWeek = {};
  let totalDelta = 0;
  for (const r of webRecovery.recordset) {
    const wk = `${r.OrderYear || ''}-${r.OrderWeek || ''}`;
    byWeek[wk] = (byWeek[wk] || 0) + 1;
    totalDelta += Number(r.delta || 0);
    console.log(
      `shk=${r.StockHistoryKey} pk=${r.ProdKey} wk=${r.OrderWeek} ${r.ChangeDtm?.toISOString?.()?.slice(0, 19) || r.ChangeDtm}`
      + ` delta=${Number(r.delta).toFixed(2)} live_after=${Number(r.AfterValue).toFixed(2)}`
      + ` | ${String(r.ProdName).slice(0, 50)}`,
    );
    console.log(`  ${r.Descr}`);
  }
  console.log('\nby OrderWeek:', byWeek);
  console.log(`total positive delta from web recovery rows: ${totalDelta.toFixed(2)}\n`);

  // 26-01 ProductStock vs expected (prev + in - out + adj for 26-01 only)
  const inflated = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, TARGET_WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName, p.CountryFlower,
           ISNULL(p.Stock,0) AS liveStock,
           ISNULL(cur.Stock,0) AS ps26,
           ISNULL(prev.Stock,0) AS prevStock,
           ISNULL(inc.inQty,0) AS in26,
           ISNULL(out26.outQty,0) AS out26,
           ISNULL(adj26.adjQty,0) AS adj26,
           ISNULL(web.webDelta,0) AS webRecoveryDelta,
           ISNULL(web.webCnt,0) AS webRecoveryCnt
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock
          FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey = ps.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) = @yws
         ORDER BY ps.StockKey DESC
      ) cur(Stock)
      OUTER APPLY (
        SELECT TOP 1 ps.Stock
          FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey = ps.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) < @yws
         ORDER BY ISNULL(sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) DESC
      ) prev(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(wd.OutQuantity,0)) AS inQty
          FROM WarehouseDetail wd
          JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
         WHERE wd.ProdKey = p.ProdKey
           AND wm.OrderYear = @yr AND wm.OrderWeek = @wk
      ) inc
      OUTER APPLY (
        SELECT SUM(ISNULL(sd.OutQuantity,0)) AS outQty
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey = p.ProdKey AND ISNULL(sd.isFix,0)=1
           AND sm.OrderYear = @yr AND sm.OrderWeek = @wk
      ) out26
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) AS adjQty
          FROM StockHistory sh
         WHERE sh.ProdKey = p.ProdKey
           AND sh.OrderYear = @yr AND sh.OrderWeek = @wk
           AND ${MANUAL}
      ) adj26
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) AS webDelta,
               COUNT(*) AS webCnt
          FROM StockHistory sh
         WHERE sh.ProdKey = p.ProdKey
           AND (ISNULL(sh.Descr,'') LIKE N'%웹복구%'
                OR (sh.ChangeID = N'nenovaSS3' AND sh.ChangeType = N'재고조정'
                    AND ISNULL(sh.Descr,'') LIKE N'%Product.Stock%'))
      ) web
     WHERE ISNULL(p.isDeleted,0)=0
       AND cur.Stock IS NOT NULL
       AND (
         ISNULL(web.webCnt,0) > 0
         OR ABS(ISNULL(cur.Stock,0) - (ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)-ISNULL(out26.outQty,0)+ISNULL(adj26.adjQty,0))) >= 1
       )
     ORDER BY ISNULL(web.webDelta,0) DESC, ABS(ISNULL(cur.Stock,0) - (ISNULL(prev.Stock,0)+ISNULL(inc.inQty,0)-ISNULL(out26.outQty,0)+ISNULL(adj26.adjQty,0))) DESC`);

  console.log(`=== ${TARGET_WEEK} web-recovery or ProductStock gap: ${inflated.recordset.length}품목 ===\n`);
  for (const r of inflated.recordset.slice(0, 80)) {
    const expected = Number(r.prevStock) + Number(r.in26) - Number(r.out26) + Number(r.adj26);
    const gap = Number(r.ps26) - expected;
    console.log(
      `pk=${r.ProdKey} live=${Number(r.liveStock).toFixed(1)} ps26=${Number(r.ps26).toFixed(1)}`
      + ` expected=${expected.toFixed(1)} gap=${gap.toFixed(1)}`
      + ` webΔ(allwk)=${Number(r.webRecoveryDelta).toFixed(1)} cnt=${r.webRecoveryCnt}`
      + ` adj26=${Number(r.adj26).toFixed(1)}`
      + ` | ${String(r.ProdName).slice(0, 45)}`,
    );
  }
  if (inflated.recordset.length > 80) console.log(`... +${inflated.recordset.length - 80} more`);

  // 26-01 manual adjustments (non 웹복구, non 확정)
  const manual26 = await pool.request()
    .input('wk', sql.NVarChar, TARGET_WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName, sh.ChangeDtm, sh.ChangeID,
           sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS delta, sh.Descr
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE sh.OrderYear = @yr AND sh.OrderWeek = @wk
       AND ${MANUAL}
     ORDER BY sh.ChangeDtm DESC`);

  console.log(`\n=== ${TARGET_WEEK} 수동 StockHistory: ${manual26.recordset.length}건 ===\n`);
  for (const r of manual26.recordset) {
    console.log(
      `shk=${r.StockHistoryKey} pk=${r.ProdKey} ${r.ChangeDtm?.toISOString?.()?.slice(0, 19) || r.ChangeDtm}`
      + ` by=${r.ChangeID} Δ=${Number(r.delta).toFixed(2)} | ${String(r.Descr || '').slice(0, 60)}`
      + ` | ${String(r.ProdName).slice(0, 40)}`,
    );
  }

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
