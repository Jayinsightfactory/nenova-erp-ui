#!/usr/bin/env node
/** Find phantom stock in 26-01 from web recovery — classify fix vs skip */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const YEAR = '2026';
const TARGET_WEEK = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '26-01';
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

  const webRows = await pool.request().query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName,
           sh.OrderYear, sh.OrderWeek, sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS webDelta,
           sh.Descr, sh.ChangeDtm
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE ISNULL(sh.Descr,'') LIKE N'%웹복구%'
     ORDER BY sh.ProdKey`);

  const manual26 = await pool.request()
    .input('wk', sql.NVarChar, TARGET_WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.ProdKey, SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) AS adj26,
           COUNT(*) AS cnt26
      FROM StockHistory sh
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
       AND ISNULL(sh.Descr,'') NOT LIKE N'%웹복구%'
     GROUP BY sh.ProdKey`);

  const manualMap = new Map(manual26.recordset.map((r) => [r.ProdKey, r]));

  const needFix = [];
  const skipManual = [];
  const skipNetZero = [];

  for (const w of webRows.recordset) {
    const pk = w.ProdKey;
    const m = manualMap.get(pk);
    const adj26 = m ? Number(m.adj26) : 0;
    const liveR = await pool.request().input('pk', sql.Int, pk)
      .query(`SELECT ISNULL(Stock,0) AS live FROM Product WHERE ProdKey=@pk`);
    const live = Number(liveR.recordset[0]?.live || 0);

    const row = {
      stockHistoryKey: w.StockHistoryKey,
      prodKey: pk,
      prodName: w.ProdName,
      webWeek: w.OrderWeek,
      webDelta: Number(w.webDelta),
      webBefore: Number(w.BeforeValue),
      webAfter: Number(w.AfterValue),
      adj26,
      manual26Cnt: m ? m.cnt26 : 0,
      live,
      action: '',
    };

    if (m && Math.abs(adj26) >= 1) {
      row.action = 'DELETE_WEB_ONLY'; // 26-01 수동조정 유지, 웹복구 이력만 삭제 후 재계산
      skipManual.push(row);
    } else if (Math.abs(row.webDelta) < 0.01) {
      row.action = 'SKIP';
      skipNetZero.push(row);
    } else {
      row.action = 'REVERSE_WEB'; // 웹복구 삭제 + Product.Stock 되돌림 + 재계산
      needFix.push(row);
    }
  }

  console.log(`=== 웹복구 ${webRows.recordset.length}건 분류 (${TARGET_WEEK} 기준) ===\n`);
  console.log(`REVERSE_WEB (26-01 수동조정 없음): ${needFix.length}`);
  for (const r of needFix) {
    console.log(
      `  pk=${r.prodKey} webΔ=${r.webDelta} before→after ${r.webBefore}→${r.webAfter}`
      + ` live=${r.live} ps26-fix | ${String(r.prodName).slice(0, 45)}`,
    );
  }
  console.log(`\nDELETE_WEB_ONLY (26-01 수동조정 있음 — 웹복구만 제거): ${skipManual.length}`);
  for (const r of skipManual) {
    console.log(
      `  pk=${r.prodKey} webΔ=${r.webDelta} adj26=${r.adj26} cnt26=${r.manual26Cnt}`
      + ` live=${r.live} | ${String(r.prodName).slice(0, 45)}`,
    );
  }

  const sumNeed = needFix.reduce((s, r) => s + r.webDelta, 0);
  console.log(`\nREVERSE_WEB phantom delta sum: ${sumNeed.toFixed(2)}`);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
