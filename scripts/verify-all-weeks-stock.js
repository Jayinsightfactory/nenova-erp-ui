#!/usr/bin/env node
/**
 * 전체 차수 재고 정합 검증 (올바른 기준)
 * - psGap: 차수잔량 ≠ prev+입고−출고+조정 (모든 차수)
 * - liveGap: 현재 운영 차수만 (Product.Stock 은 전역 1값)
 * - negPs, batchHist, guardNeg
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const YEAR = '2026';
const MIN_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 1);
const CURRENT_WEEK = process.argv.find((a) => a.startsWith('--current='))?.split('=')[1] || '26-01';
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function loadWeeks(pool) {
  const r = await pool.request().input('yr', sql.NVarChar, YEAR).query(`
    SELECT DISTINCT sm.OrderWeek AS wk FROM ShipmentMaster sm
     WHERE sm.isDeleted=0 AND sm.OrderYear=@yr ORDER BY sm.OrderWeek`);
  return r.recordset.map((x) => x.wk);
}

async function verifyWeek(pool, week, isCurrent) {
  const yws = YEAR + week.replace('-', '');
  const rows = await pool.request().input('yws', sql.NVarChar, yws).input('wk', sql.NVarChar, week).input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, ISNULL(p.Stock,0) live, ISNULL(cur.Stock,0) ps,
           ISNULL(prev.Stock,0) prevPs, ISNULL(inc.inQty,0) inQty, ISNULL(out26.outQty,0) outQty, ISNULL(adj26.adjQty,0) adj26
      FROM Product p
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) cur(Stock)
      OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek<@yws ORDER BY sm.OrderYearWeek DESC) prev(Stock)
      OUTER APPLY (SELECT SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0) inc
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.ProdKey=p.ProdKey AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0) out26
      OUTER APPLY (SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty FROM StockHistory sh WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}) adj26
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL`);

  let psGap = 0;
  let liveGap = 0;
  let negPs = 0;
  const top = [];
  for (const row of rows.recordset) {
    const expected = Number(row.prevPs) + Number(row.inQty) - Number(row.outQty) + Number(row.adj26);
    const pg = Number(row.ps) - expected;
    const lg = Number(row.live) - Number(row.ps);
    if (Math.abs(pg) >= MIN_GAP) {
      psGap += 1;
      if (top.length < 3 && Math.abs(pg) >= MIN_GAP) top.push({ pk: row.ProdKey, ps: row.ps, exp: expected, pg });
    }
    if (isCurrent && Math.abs(lg) >= MIN_GAP) liveGap += 1;
    if (Number(row.ps) < 0) negPs += 1;
  }

  const batchHist = await pool.request().input('wk', sql.NVarChar, week).input('yr', sql.NVarChar, YEAR)
    .query(`SELECT COUNT(*) cnt FROM StockHistory WHERE OrderYear=@yr AND OrderWeek=@wk AND ISNULL(Descr,'') LIKE N'%잔량정리:%'`);

  const guard = await pool.request()
    .input('wk', sql.NVarChar, week).input('yr', sql.NVarChar, YEAR).input('ywk', sql.NVarChar, yws)
    .query(`
    WITH out_qty AS (
      SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity,0)) outQty FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0 GROUP BY sd.ProdKey
    ), in_qty AS (
      SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity,0)) inQty FROM WarehouseMaster wm
      JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      WHERE wm.OrderWeek=@wk AND wm.isDeleted=0 GROUP BY wd.ProdKey
    ), adjust_qty AS (
      SELECT sh.ProdKey, SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjustQty FROM StockHistory sh
      WHERE sh.OrderWeek=@wk AND ${MANUAL} AND ISNULL(sh.Descr,'') NOT LIKE N'%잔량정리:%' GROUP BY sh.ProdKey
    ), stock_base AS (
      SELECT p.ProdKey, ISNULL(prev.prevStock,ISNULL(p.Stock,0)) prevStock, ISNULL(p.Stock,0) productStock,
        ISNULL(iq.inQty,0)+ISNULL(aq.adjustQty,0) inQty, ISNULL(oq.outQty,0) outQty
      FROM out_qty oq JOIN Product p ON p.ProdKey=oq.ProdKey AND p.isDeleted=0
      LEFT JOIN in_qty iq ON iq.ProdKey=oq.ProdKey LEFT JOIN adjust_qty aq ON aq.ProdKey=oq.ProdKey
      OUTER APPLY (
        SELECT TOP 1 ps.Stock prevStock FROM ProductStock ps JOIN StockMaster sm2 ON ps.StockKey=sm2.StockKey
        WHERE ps.ProdKey=p.ProdKey AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)),@yr)+REPLACE(sm2.OrderWeek,'-','')<@ywk
          AND (sm2.isFix IS NULL OR sm2.isFix=1)
        ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)),@yr)+REPLACE(sm2.OrderWeek,'-','') DESC
      ) prev
    )
    SELECT COUNT(*) cnt FROM stock_base WHERE prevStock+inQty-outQty<0 OR productStock+inQty-outQty<0`);

  const issues = psGap + liveGap;
  const ok = issues === 0 && negPs === 0 && Number(batchHist.recordset[0].cnt) === 0
    && (!isCurrent || Number(guard.recordset[0].cnt) === 0);

  return { week, scanned: rows.recordset.length, psGap, liveGap, negPs, batchHist: batchHist.recordset[0].cnt, guardNeg: guard.recordset[0].cnt, ok, top, isCurrent };
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 600000 },
  });

  const globalNeg = await pool.request().query(`SELECT COUNT(*) cnt FROM Product WHERE isDeleted=0 AND ISNULL(Stock,0)<0`);
  const webRec = await pool.request().query(`SELECT COUNT(*) cnt FROM StockHistory WHERE ISNULL(Descr,'') LIKE N'%웹복구%'`);
  const weeks = await loadWeeks(pool);

  console.log(`=== 전체 차수 검증 | 운영차수=${CURRENT_WEEK} | weeks=${weeks.length} ===`);
  console.log(`global live<0: ${globalNeg.recordset[0].cnt} | 웹복구: ${webRec.recordset[0].cnt}\n`);

  const results = [];
  for (const wk of weeks) {
    const r = await verifyWeek(pool, wk, wk === CURRENT_WEEK);
    results.push(r);
    if (!r.ok) {
      console.log(`[NG] ${wk}${r.isCurrent ? '*' : ''} psGap=${r.psGap} liveGap=${r.liveGap} negPs=${r.negPs} batch=${r.batchHist} guard=${r.guardNeg}`);
      for (const t of r.top) console.log(`      pk=${t.pk} ps=${t.ps} exp=${t.exp.toFixed(1)} psGap=${t.pg.toFixed(1)}`);
    }
  }

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const badPs = bad.filter((r) => r.psGap > 0 || r.negPs > 0 || r.batchHist > 0);
  const badLive = bad.filter((r) => r.isCurrent && (r.liveGap > 0 || r.guardNeg > 0));

  console.log(`\n=== 요약 (*=운영차수 ${CURRENT_WEEK}) ===`);
  console.log(`OK: ${ok.length}/${results.length}`);
  console.log(`ps/neg/batch 문제 차수: ${badPs.length} → ${badPs.map((b) => b.week).join(', ') || '없음'}`);
  console.log(`운영차수 live/guard 문제: ${badLive.length > 0 ? CURRENT_WEEK : '없음'}`);
  if (badPs.length) console.log(`  psGap 합계: ${badPs.reduce((s, r) => s + r.psGap, 0)} | negPs 합계: ${badPs.reduce((s, r) => s + r.negPs, 0)}`);

  await pool.close();
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
