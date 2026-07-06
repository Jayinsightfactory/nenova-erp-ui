#!/usr/bin/env node
/** 28-01 주문 폭증 — nenovaSS3 / 27차 유입 여부 역추적 */
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

function kst(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

const W28 = process.argv[2] || '28-01';
const W27 = process.argv[3] || '27-01';

console.log(`=== ${W28} 주문 폭증 조사 (vs ${W27}) ===\n`);

// 28-01 OrderMaster 요약
const om28 = await pool.request().input('wk', sql.NVarChar, W28).query(`
  SELECT om.OrderMasterKey, om.OrderWeek, om.OrderYear, om.CreateID, om.CreateDtm, om.LastUpdateID, om.LastUpdateDtm,
         c.CustName, c.CustKey,
         COUNT(od.OrderDetailKey) AS lineCnt,
         SUM(ISNULL(od.OutQuantity,0)) AS sumOut
    FROM OrderMaster om
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   WHERE om.isDeleted = 0 AND om.OrderWeek = @wk
   GROUP BY om.OrderMasterKey, om.OrderWeek, om.OrderYear, om.CreateID, om.CreateDtm, om.LastUpdateID, om.LastUpdateDtm, c.CustName, c.CustKey
   ORDER BY om.CreateDtm DESC`);

console.log(`【${W28} OrderMaster ${om28.recordset.length}건】`);
const byUser = {};
for (const r of om28.recordset) {
  const uid = r.CreateID || '(null)';
  byUser[uid] = (byUser[uid] || 0) + 1;
}
console.log('CreateID별:', byUser);
console.log('최근 15건:');
for (const r of om28.recordset.slice(0, 15)) {
  console.log(`  ${kst(r.CreateDtm)} | ${r.CreateID} | ${r.CustName} | lines=${r.lineCnt} out=${r.sumOut}`);
}

// 27 vs 28 거래처별 비교
const cmp = await pool.request()
  .input('w28', sql.NVarChar, W28)
  .input('w27', sql.NVarChar, W27)
  .query(`
  SELECT c.CustName, c.CustKey,
         SUM(CASE WHEN om.OrderWeek = @w27 THEN ISNULL(od.OutQuantity,0) ELSE 0 END) AS w27Out,
         SUM(CASE WHEN om.OrderWeek = @w28 THEN ISNULL(od.OutQuantity,0) ELSE 0 END) AS w28Out,
         MAX(CASE WHEN om.OrderWeek = @w28 THEN om.CreateID END) AS w28CreateID,
         MAX(CASE WHEN om.OrderWeek = @w28 THEN om.CreateDtm END) AS w28CreateDtm
    FROM OrderMaster om
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   WHERE om.isDeleted = 0 AND om.OrderWeek IN (@w27, @w28)
   GROUP BY c.CustName, c.CustKey
  HAVING SUM(CASE WHEN om.OrderWeek = @w28 THEN ISNULL(od.OutQuantity,0) ELSE 0 END) > 0
   ORDER BY SUM(CASE WHEN om.OrderWeek = @w28 THEN ISNULL(od.OutQuantity,0) ELSE 0 END) DESC`);

console.log(`\n【거래처별 ${W27} vs ${W28} 출고수량】 상위 20`);
for (const r of cmp.recordset.slice(0, 20)) {
  console.log(`  ${r.CustName}: w27=${r.w27Out} w28=${r.w28Out} | w28 by ${r.w28CreateID} @ ${kst(r.w28CreateDtm)}`);
}

// nenovaSS3 로 28-01 생성/수정
const ss3 = await pool.request().input('wk', sql.NVarChar, W28).query(`
  SELECT om.CreateDtm, om.CreateID, om.LastUpdateDtm, om.LastUpdateID, c.CustName,
         COUNT(od.OrderDetailKey) AS lines, SUM(ISNULL(od.OutQuantity,0)) AS outQty
    FROM OrderMaster om
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   WHERE om.isDeleted = 0 AND om.OrderWeek = @wk
     AND (om.CreateID = N'nenovaSS3' OR om.LastUpdateID = N'nenovaSS3')
   GROUP BY om.CreateDtm, om.CreateID, om.LastUpdateDtm, om.LastUpdateID, c.CustName
   ORDER BY om.CreateDtm DESC`);

console.log(`\n【nenovaSS3 관련 ${W28} ${ss3.recordset.length}건】`);
for (const r of ss3.recordset.slice(0, 30)) {
  console.log(`  ${kst(r.CreateDtm)} create=${r.CreateID} upd=${r.LastUpdateID} | ${r.CustName} | out=${r.outQty}`);
}

// OrderHistory — 28-01 최근
try {
  const oh = await pool.request().input('wk', sql.NVarChar, W28).query(`
    SELECT TOP 50 oh.ChangeDtm, oh.ChangeID, oh.ChangeType, oh.BeforeValue, oh.AfterValue, oh.Descr,
           c.CustName, p.ProdName, om.OrderWeek
      FROM OrderHistory oh
      JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
      JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
      JOIN Customer c ON om.CustKey = c.CustKey
      LEFT JOIN Product p ON od.ProdKey = p.ProdKey
     WHERE om.OrderWeek = @wk
     ORDER BY oh.ChangeDtm DESC`);
  console.log(`\n【OrderHistory ${W28} 최근 ${oh.recordset.length}건】`);
  for (const r of oh.recordset.slice(0, 25)) {
    console.log(`  ${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${r.CustName} | ${(r.ProdName||'').slice(0,30)} | ${r.BeforeValue}→${r.AfterValue} | ${(r.Descr||'').slice(0,40)}`);
  }
} catch (e) {
  console.log('\nOrderHistory skip:', e.message);
}

// 동일 거래처·품목 27 vs 28 수량 일치(복사 의심)
const dup = await pool.request()
  .input('w28', sql.NVarChar, W28)
  .input('w27', sql.NVarChar, W27)
  .query(`
  WITH w27 AS (
    SELECT om.CustKey, od.ProdKey, SUM(ISNULL(od.OutQuantity,0)) AS qty
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
     WHERE om.isDeleted = 0 AND om.OrderWeek = @w27
     GROUP BY om.CustKey, od.ProdKey
  ),
  w28 AS (
    SELECT om.CustKey, od.ProdKey, SUM(ISNULL(od.OutQuantity,0)) AS qty, MAX(om.CreateID) AS createID, MAX(om.CreateDtm) AS createDtm
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
     WHERE om.isDeleted = 0 AND om.OrderWeek = @w28
     GROUP BY om.CustKey, od.ProdKey
  )
  SELECT c.CustName, p.ProdName, w27.qty AS w27qty, w28.qty AS w28qty, w28.createID, w28.createDtm
    FROM w27
    JOIN w28 ON w27.CustKey = w28.CustKey AND w27.ProdKey = w28.ProdKey
    JOIN Customer c ON w27.CustKey = c.CustKey
    JOIN Product p ON w27.ProdKey = p.ProdKey
   WHERE w27.qty > 0 AND w28.qty > 0 AND ABS(w27.qty - w28.qty) < 0.01
   ORDER BY w28.createDtm DESC`);

console.log(`\n【27→28 동일 수량 복사 의심 ${dup.recordset.length}건 (상위 15)】`);
for (const r of dup.recordset.slice(0, 15)) {
  console.log(`  ${r.CustName} | ${(r.ProdName||'').slice(0,35)} | qty=${r.w27qty} | by ${r.createID} @ ${kst(r.createDtm)}`);
}

// AppLog / ActionLog
for (const tbl of ['AppLog', 'ActionLog']) {
  try {
    const log = await pool.request().input('wk', sql.NVarChar, W28).query(`
      SELECT TOP 30 * FROM ${tbl}
       WHERE (CAST(Detail AS NVARCHAR(MAX)) LIKE N'%28-01%' OR CAST(Detail AS NVARCHAR(MAX)) LIKE N'%28-1%')
         AND (CAST(Detail AS NVARCHAR(MAX)) LIKE N'%nenovaSS3%' OR UserID = N'nenovaSS3' OR ChangeID = N'nenovaSS3')
       ORDER BY CreateDtm DESC`);
    if (log.recordset.length) {
      console.log(`\n【${tbl}】`);
      for (const r of log.recordset) {
        console.log(`  ${kst(r.CreateDtm)} | ${r.UserID || r.ChangeID || ''} | ${String(r.Detail || r.Action || '').slice(0, 120)}`);
      }
    }
  } catch { /* */ }
}

// 오늘/최근 28-01 bulk insert 시간대
const timeline = await pool.request().input('wk', sql.NVarChar, W28).query(`
  SELECT CONVERT(varchar(16), om.CreateDtm, 120) AS bucket, om.CreateID, COUNT(*) AS masters, SUM(ISNULL(x.outQty,0)) AS outQty
    FROM OrderMaster om
    OUTER APPLY (
      SELECT SUM(ISNULL(od.OutQuantity,0)) outQty FROM OrderDetail od
       WHERE od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
    ) x
   WHERE om.isDeleted = 0 AND om.OrderWeek = @wk
   GROUP BY CONVERT(varchar(16), om.CreateDtm, 120), om.CreateID
   ORDER BY bucket DESC`);

console.log(`\n【${W28} 생성 시간대】`);
for (const r of timeline.recordset.slice(0, 20)) {
  console.log(`  ${r.bucket} | ${r.CreateID} | masters=${r.masters} out=${r.outQty}`);
}

console.log(`\n【27 vs 28 합계】`);
const tot = await pool.request().query(`
  SELECT om.OrderWeek, COUNT(DISTINCT om.OrderMasterKey) masters, COUNT(od.OrderDetailKey) lines, SUM(ISNULL(od.OutQuantity,0)) outQty
  FROM OrderMaster om
  LEFT JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
  WHERE om.isDeleted=0 AND om.OrderWeek IN ('27-01','28-01')
  GROUP BY om.OrderWeek ORDER BY om.OrderWeek`);
for (const r of tot.recordset) console.log(`  ${r.OrderWeek}: masters=${r.masters} lines=${r.lines} out=${r.outQty}`);

// AppLog createOrder 28-01
try {
  const log = await pool.request().query(`
    SELECT TOP 40 CreateDtm, Category, Step, Detail, IsError
      FROM AppLog
     WHERE Category IN (N'createOrder', N'ORDER_WRITE', N'parse-paste')
       AND (Detail LIKE N'%28-01%' OR Detail LIKE N'%wk=28-01%' OR Detail LIKE N'%week=28-01%')
     ORDER BY CreateDtm DESC`);
  console.log(`\n【AppLog 주문 28-01 ${log.recordset.length}건】`);
  for (const r of log.recordset) {
    console.log(`  ${kst(r.CreateDtm)} | ${r.Category}/${r.Step} | err=${r.IsError} | ${String(r.Detail||'').slice(0,100)}`);
  }
} catch (e) { console.log('AppLog:', e.message); }

// admin bulk 7/3
const bulk = await pool.request().query(`
  SELECT c.CustName, p.ProdName, od.OutQuantity, om.CreateDtm
    FROM OrderDetail od
    JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
    JOIN Customer c ON om.CustKey=c.CustKey
    JOIN Product p ON od.ProdKey=p.ProdKey
   WHERE om.OrderWeek='28-01' AND om.CreateID='admin' AND om.CreateDtm >= '2026-07-02'
   ORDER BY om.CreateDtm, c.CustName`);
console.log(`\n【7/3 이후 admin 신규 28-01 ${bulk.recordset.length} lines】`);
for (const r of bulk.recordset) {
  console.log(`  ${kst(r.CreateDtm)} | ${r.CustName} | ${(r.ProdName||'').slice(0,30)} qty=${r.OutQuantity}`);
}

await pool.close();
