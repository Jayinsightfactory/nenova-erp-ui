#!/usr/bin/env node
/**
 * undo repair-negative-product-stock (웹복구) — 26-01 유령재고 제거
 *
 * - 26-01 수동조정 없음(23품목): 웹복구 StockHistory 삭제 + Product.Stock 을 복구 전값으로
 * - 26-01 수동조정 있음(20품목): 웹복구 StockHistory 만 삭제 (사용자 조정 유지)
 * - 이후 25-02 → 26-01 usp_StockCalculation 재실행
 *
 * Usage:
 *   node scripts/undo-web-recovery-stock.js
 *   node scripts/undo-web-recovery-stock.js --apply
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
const TARGET_WEEK = '26-01';
const RECALC_WEEKS = ['25-02', '26-01'];
const UID = 'nenovaSS3';
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

async function runCalc(pool, week, prodKey) {
  const r = await pool.request()
    .input('yr', sql.NVarChar, YEAR)
    .input('wk', sql.NVarChar, week)
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

async function main() {
  const pool = await connect();

  const webRows = await pool.request().query(`
    SELECT sh.StockHistoryKey, sh.ProdKey, p.ProdName,
           sh.BeforeValue, sh.AfterValue,
           ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0) AS webDelta
      FROM StockHistory sh
      JOIN Product p ON p.ProdKey = sh.ProdKey
     WHERE ISNULL(sh.Descr,'') LIKE N'%웹복구%'
     ORDER BY sh.ProdKey`);

  const manual26 = await pool.request()
    .input('wk', sql.NVarChar, TARGET_WEEK)
    .input('yr', sql.NVarChar, YEAR)
    .query(`
    SELECT sh.ProdKey
      FROM StockHistory sh
     WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND ${MANUAL}
       AND ISNULL(sh.Descr,'') NOT LIKE N'%웹복구%'
     GROUP BY sh.ProdKey`);
  const manualSet = new Set(manual26.recordset.map((r) => r.ProdKey));

  const reverse = [];
  const deleteOnly = [];
  for (const w of webRows.recordset) {
    const row = {
      stockHistoryKey: w.StockHistoryKey,
      prodKey: w.ProdKey,
      prodName: w.ProdName,
      webBefore: Number(w.BeforeValue),
      webAfter: Number(w.AfterValue),
      webDelta: Number(w.webDelta),
    };
    if (manualSet.has(w.ProdKey)) deleteOnly.push(row);
    else reverse.push(row);
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`웹복구 총 ${webRows.recordset.length}건 — REVERSE ${reverse.length}, DELETE_ONLY ${deleteOnly.length}\n`);

  for (const r of reverse) {
    const liveR = await pool.request().input('pk', sql.Int, r.prodKey)
      .query(`SELECT ISNULL(Stock,0) AS live FROM Product WHERE ProdKey=@pk`);
    r.liveBefore = Number(liveR.recordset[0]?.live || 0);
    console.log(
      `REVERSE pk=${r.prodKey} shk=${r.stockHistoryKey} live ${r.liveBefore}→${r.webBefore}`
      + ` (undo web +${r.webDelta}) | ${String(r.prodName).slice(0, 45)}`,
    );
  }
  for (const r of deleteOnly) {
    console.log(
      `DELETE_ONLY pk=${r.prodKey} shk=${r.stockHistoryKey} webΔ=${r.webDelta}`
      + ` | ${String(r.prodName).slice(0, 45)}`,
    );
  }

  if (!APPLY) {
    console.log('\nAdd --apply to execute.');
    await pool.close();
    return;
  }

  let delOk = 0;
  let revOk = 0;
  const prodKeys = new Set();

  for (const r of reverse) {
    try {
      await pool.request()
        .input('shk', sql.Int, r.stockHistoryKey)
        .input('pk', sql.Int, r.prodKey)
        .input('before', sql.Float, r.webBefore)
        .query(`
          BEGIN TRANSACTION;
          DELETE FROM StockHistory WHERE StockHistoryKey=@shk;
          UPDATE Product SET Stock=@before WHERE ProdKey=@pk;
          COMMIT;`);
      revOk += 1;
      prodKeys.add(r.prodKey);
    } catch (e) {
      console.error(`FAIL REVERSE pk=${r.prodKey}:`, e.message);
    }
  }

  for (const r of deleteOnly) {
    try {
      await pool.request()
        .input('shk', sql.Int, r.stockHistoryKey)
        .query(`DELETE FROM StockHistory WHERE StockHistoryKey=@shk`);
      delOk += 1;
      prodKeys.add(r.prodKey);
    } catch (e) {
      console.error(`FAIL DELETE pk=${r.prodKey}:`, e.message);
    }
  }

  let calcOk = 0;
  let calcFail = 0;
  for (const pk of [...prodKeys].sort((a, b) => a - b)) {
    for (const wk of RECALC_WEEKS) {
      const sp = await runCalc(pool, wk, pk);
      if (Number(sp.result) === 0) calcOk += 1;
      else {
        calcFail += 1;
        console.error(`calc FAIL pk=${pk} wk=${wk} result=${sp.result} ${sp.message || ''}`);
      }
      await new Promise((res) => setTimeout(res, 80));
    }
  }

  const remainWeb = await pool.request().query(`
    SELECT COUNT(*) AS cnt FROM StockHistory WHERE Descr LIKE N'%웹복구%'`);
  console.log(`\nDone: reverse=${revOk}/${reverse.length}, deleteOnly=${delOk}/${deleteOnly.length}`);
  console.log(`calc ok=${calcOk} fail=${calcFail}, web recovery rows left=${remainWeb.recordset[0].cnt}`);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
