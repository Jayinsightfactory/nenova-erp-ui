#!/usr/bin/env node
/**
 * 26-01 차수잔량(ProductStock) ↔ 실시간(Product.Stock) 동기화
 * - ps > live: 차수잔량 유령 → live 기준으로 내림
 * - live > ps: 실시간 과다 → ps 기준으로 내림
 * - 26-01 수동 StockHistory(adj26≠0) 품목은 스킵
 *
 * Usage:
 *   node scripts/sync-week-stock-to-live.js 26-01 --country=네덜란드
 *   node scripts/sync-week-stock-to-live.js 26-01 --country=네덜란드 --apply
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const APPLY = process.argv.includes('--apply');
const YEAR = '2026';
const WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
const countryArg = process.argv.find((a) => a.startsWith('--country='));
const COUNTRY = countryArg ? countryArg.slice('--country='.length) : '';
const MIN_GAP = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] || 5);
const UID = 'nenovaSS3';
const YWS = YEAR + WEEK.replace('-', '');
const MANUAL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function connect() {
  return sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
}

async function runCalc(pool, prodKey) {
  const r = await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, WEEK)
    .input('pk', sql.Int, prodKey)
    .input('uid', sql.NVarChar, UID)
    .query(`
      DECLARE @r INT, @m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation
           @OrderYear=@yr, @OrderWeek=@wk, @ProdKey=@pk,
           @iUserID=@uid, @oResult=@r OUTPUT, @oMessage=@m OUTPUT;
      SELECT ISNULL(@r,0) AS result, @m AS message;`);
  return r.recordset[0] || { result: -1, message: '' };
}

async function loadTargets(pool) {
  const countryFilter = COUNTRY
    ? `AND (p.CounName LIKE N'%${COUNTRY.replace(/'/g, "''")}%' OR p.CountryFlower LIKE N'%${COUNTRY.replace(/'/g, "''")}%')`
    : '';

  const r = await pool.request()
    .input('yws', sql.NVarChar, YWS)
    .input('wk', sql.NVarChar, WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT p.ProdKey, p.ProdName,
           ISNULL(p.Stock,0) AS live,
           ISNULL(cur.Stock,0) AS ps,
           ISNULL(adj26.adjQty,0) AS adj26
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps
          JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws
      ) cur(Stock)
      OUTER APPLY (
        SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) adjQty
          FROM StockHistory sh
         WHERE sh.ProdKey=p.ProdKey AND sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
      ) adj26
     WHERE ISNULL(p.isDeleted,0)=0 AND cur.Stock IS NOT NULL
       ${countryFilter}
     ORDER BY p.ProdKey`);

  const targets = [];
  for (const row of r.recordset) {
    const live = Number(row.live);
    const ps = Number(row.ps);
    const gap = live - ps;
    if (Math.abs(gap) < MIN_GAP) continue;
    if (Math.abs(Number(row.adj26)) >= 0.01) continue;

    let targetLive;
    let mode;
    let beforeVal;
    let afterVal;
    if (ps > live) {
      targetLive = live;
      mode = 'ps→live';
      beforeVal = ps;
      afterVal = live;
    } else {
      targetLive = ps;
      mode = 'live→ps';
      beforeVal = live;
      afterVal = ps;
    }

    targets.push({
      prodKey: row.ProdKey,
      prodName: row.ProdName,
      live,
      ps,
      gap,
      targetLive,
      mode,
      beforeVal,
      afterVal,
      delta: afterVal - beforeVal,
    });
  }
  return targets;
}

async function main() {
  const pool = await connect();
  const targets = await loadTargets(pool);
  const label = COUNTRY || '전체';

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${WEEK} ${label} | targets=${targets.length} (gap>=${MIN_GAP}, adj26=0)\n`);

  const byMode = { 'ps→live': 0, 'live→ps': 0 };
  for (const t of targets) {
    byMode[t.mode] += 1;
    console.log(
      `${t.mode} pk=${t.prodKey} ps=${t.ps} live=${t.live} → ${t.targetLive} (Δ=${t.delta.toFixed(2)})`
      + ` | ${String(t.prodName).slice(0, 50)}`,
    );
  }
  console.log(`\nby mode:`, byMode);

  if (!APPLY) {
    console.log('\nAdd --apply to execute.');
    await pool.close();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    try {
      if (t.mode === 'ps→live') {
        await pool.request()
          .input('pk', sql.Int, t.prodKey)
          .input('before', sql.Float, t.beforeVal)
          .input('after', sql.Float, t.afterVal)
          .input('uid', sql.NVarChar, UID)
          .input('yr', sql.NVarChar, YEAR)
          .input('wk', sql.NVarChar, WEEK)
          .input('descr', sql.NVarChar, `26-01잔량정리:${t.mode} ps${t.ps}→live${t.targetLive}`)
          .query(`
            BEGIN TRANSACTION;
            INSERT INTO StockHistory
              (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
               BeforeValue, AfterValue, Descr, ProdKey)
            VALUES (GETDATE(), @yr, @wk, @uid, N'재고조정', N'재고수량',
               @before, @after, @descr, @pk);
            UPDATE Product SET Stock = @after WHERE ProdKey = @pk;
            COMMIT;`);
      } else {
        // live→ps: 차수잔량(ps)은 이미 맞음 — 실시간(Product.Stock)만 내림
        await pool.request()
          .input('pk', sql.Int, t.prodKey)
          .input('after', sql.Float, t.afterVal)
          .query(`UPDATE Product SET Stock = @after WHERE ProdKey = @pk`);
      }

      const sp = await runCalc(pool, t.prodKey);
      if (Number(sp.result) === 0) {
        ok += 1;
      } else {
        fail += 1;
        console.error(`calc FAIL pk=${t.prodKey}: ${sp.message || sp.result}`);
      }
      await new Promise((res) => setTimeout(res, 60));
    } catch (e) {
      fail += 1;
      console.error(`FAIL pk=${t.prodKey}:`, e.message);
    }
  }

  console.log(`\nDone: ok=${ok} fail=${fail}/${targets.length}`);
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
