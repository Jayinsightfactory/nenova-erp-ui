#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const kst = (d) => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

// 거래처명 후보
const custs = await pool.request().query(`
  SELECT CustKey, CustName FROM Customer
   WHERE isDeleted = 0 AND (CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')
   ORDER BY CustName`);
console.log('=== 트라움/라움 거래처 ===');
for (const c of custs.recordset) console.log(c.CustKey, c.CustName);

const custKeys = custs.recordset.map(c => c.CustKey);
if (!custKeys.length) {
  console.log('거래처 없음');
  await pool.close();
  process.exit(0);
}
const ckList = custKeys.join(',');

// 28-01 마스터
const masters = await pool.request().query(`
  SELECT om.OrderMasterKey, c.CustName, om.OrderWeek, om.CreateDtm, om.CreateID, om.LastUpdateDtm, om.LastUpdateID,
         (SELECT COUNT(*) FROM OrderDetail od WHERE od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0) AS lineCnt,
         (SELECT SUM(OutQuantity) FROM OrderDetail od WHERE od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0) AS totalQty
    FROM OrderMaster om JOIN Customer c ON om.CustKey=c.CustKey
   WHERE om.isDeleted=0 AND om.OrderWeek='28-01' AND om.CustKey IN (${ckList})
   ORDER BY c.CustName`);
console.log('\n=== 28-01 OrderMaster ===');
for (const r of masters.recordset) {
  console.log(`Key=${r.OrderMasterKey} | ${r.CustName} | Create ${kst(r.CreateDtm)} ${r.CreateID} | Update ${kst(r.LastUpdateDtm)} ${r.LastUpdateID} | lines=${r.lineCnt} qty=${r.totalQty}`);
}

// 7월 2일 KST = UTC 7/1 15:00 ~ 7/2 14:59:59
const july2Start = '2026-07-01 15:00:00';
const july2End = '2026-07-02 15:00:00';

const oh = await pool.request().query(`
  SELECT oh.ChangeDtm, oh.ChangeID, oh.ChangeType, c.CustName, p.ProdName, oh.BeforeValue, oh.AfterValue, oh.Descr,
         om.OrderWeek, od.OrderDetailKey
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE om.CustKey IN (${ckList})
     AND om.OrderWeek = '28-01'
     AND oh.ChangeDtm >= '${july2Start}' AND oh.ChangeDtm < '${july2End}'
   ORDER BY oh.ChangeDtm`);

console.log(`\n=== 28-01 라움 OrderHistory (7/2 KST 하루, ${oh.recordset.length}건) ===`);
for (const r of oh.recordset) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${(r.ProdName||'').slice(0,35)} | ${r.BeforeValue}→${r.AfterValue} | ${r.Descr||''}`);
}

// 7/3 새벽 KST (7/2 17:30~18:00 UTC) — 이전에 02:37 버스트
const oh3 = await pool.request().query(`
  SELECT oh.ChangeDtm, oh.ChangeID, oh.ChangeType, c.CustName, p.ProdName, oh.BeforeValue, oh.AfterValue
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE om.CustKey IN (${ckList}) AND om.OrderWeek='28-01'
     AND oh.ChangeDtm >= '2026-07-02 17:30:00' AND oh.ChangeDtm < '2026-07-02 18:00:00'
   ORDER BY oh.ChangeDtm`);
console.log(`\n=== 28-01 라움 OrderHistory (7/3 02:30~03:00 KST, ${oh3.recordset.length}건) ===`);
for (const r of oh3.recordset) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${(r.ProdName||'').slice(0,35)} | ${r.BeforeValue}→${r.AfterValue}`);
}

// 현재 28-01 상세 + 27-01 비교
const cmp = await pool.request().query(`
  SELECT c.CustName, p.ProdName,
         MAX(CASE WHEN om.OrderWeek='27-01' THEN od.OutQuantity END) AS q27,
         MAX(CASE WHEN om.OrderWeek='28-01' THEN od.OutQuantity END) AS q28
    FROM OrderDetail od
    JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
    JOIN Customer c ON om.CustKey=c.CustKey
    JOIN Product p ON od.ProdKey=p.ProdKey
   WHERE om.isDeleted=0 AND od.isDeleted=0 AND om.CustKey IN (${ckList})
     AND om.OrderWeek IN ('27-01','28-01')
   GROUP BY c.CustName, p.ProdName, od.ProdKey
  HAVING MAX(CASE WHEN om.OrderWeek='28-01' THEN od.OutQuantity END) IS NOT NULL
   ORDER BY c.CustName, p.ProdName`);
console.log('\n=== 27-01 vs 28-01 수량 (라움) ===');
for (const r of cmp.recordset) {
  const same = r.q27 === r.q28 ? '동일' : (r.q27 == null ? '27없음' : '');
  console.log(`${(r.ProdName||'').slice(0,40).padEnd(42)} | 27=${r.q27 ?? '-'} | 28=${r.q28} ${same}`);
}

// AppLog
try {
  const log = await pool.request().query(`
    SELECT TOP 30 LogDtm, UserID, ActionName, Descr
      FROM AppLog
     WHERE LogDtm >= '2026-07-01 15:00:00' AND LogDtm < '2026-07-02 18:00:00'
       AND (Descr LIKE N'%라움%' OR Descr LIKE N'%트라움%' OR Descr LIKE N'%28-01%' OR ActionName LIKE N'%createOrder%')
     ORDER BY LogDtm`);
  console.log(`\n=== AppLog (7/2~7/3, ${log.recordset.length}건) ===`);
  for (const r of log.recordset) console.log(kst(r.LogDtm), r.UserID, r.ActionName, (r.Descr||'').slice(0,120));
} catch (e) {
  console.log('\nAppLog 조회 실패:', e.message);
}

// 라움 28-01 전체 이력 + 날짜 표기
if (masters.recordset[0]) {
  const omk = masters.recordset[0].OrderMasterKey;
  const allOh = await pool.request().query(`
    SELECT oh.ChangeDtm, oh.ChangeID, p.ProdName, oh.BeforeValue, oh.AfterValue, oh.Descr, oh.ChangeType
      FROM OrderHistory oh
      JOIN OrderDetail od ON oh.OrderDetailKey=od.OrderDetailKey
      JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
      LEFT JOIN Product p ON od.ProdKey=p.ProdKey
     WHERE om.OrderMasterKey=${omk}
     ORDER BY oh.ChangeDtm`);
  console.log(`\n=== 라움 OrderMasterKey=${omk} 전체 OrderHistory (${allOh.recordset.length}건) ===`);
  for (const r of allOh.recordset) {
    const utc = new Date(r.ChangeDtm).toISOString();
    console.log(`${kst(r.ChangeDtm)} (UTC ${utc}) | ${r.ChangeID} | ${r.ChangeType} | ${(r.ProdName||'').slice(0,32)} | ${r.BeforeValue}→${r.AfterValue}`);
  }
  const raw = await pool.request().query(`SELECT CreateDtm, LastUpdateDtm FROM OrderMaster WHERE OrderMasterKey=${omk}`);
  const cr = raw.recordset[0];
  console.log(`CreateDtm raw: ${cr.CreateDtm} → KST ${kst(cr.CreateDtm)}`);
  console.log(`LastUpdateDtm raw: ${cr.LastUpdateDtm} → KST ${kst(cr.LastUpdateDtm)}`);
}

// 7월2일로 보일 수 있는 경우: CAST date = 2026-07-02 (서버 로컬)
const castJ2 = await pool.request().query(`
  SELECT COUNT(*) AS cnt FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey=od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
   WHERE om.OrderWeek='28-01' AND oh.ChangeID='nenovaSS3'
     AND CAST(oh.ChangeDtm AS DATE) = '2026-07-02'`);
console.log(`\n28-01 nenovaSS3, CAST(ChangeDtm AS DATE)='2026-07-02': ${castJ2.recordset[0].cnt}건 (전산 UI가 UTC 날짜만 보여주면 7/2로 표시될 수 있음)`);

await pool.close();
