#!/usr/bin/env node
/** 26차 목요일~오늘 분배/주문/차감 변경 이력 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const fromArg = process.argv[2];
const toArg = process.argv[3];
// 기본: 이번 주 목요일 00:00 ~ 내일 00:00 (오늘 포함)
const now = new Date();
const day = now.getDay(); // 0=일
const daysSinceThu = (day + 7 - 4) % 7; // 목요일=4
const thu = new Date(now);
thu.setDate(now.getDate() - daysSinceThu);
thu.setHours(0, 0, 0, 0);
const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);
tomorrow.setHours(0, 0, 0, 0);

const from = fromArg ? new Date(fromArg) : thu;
const to = toArg ? new Date(toArg) : tomorrow;

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

console.log('=== 26차 변경 조회 ===');
console.log('기간:', from.toISOString().slice(0, 19), '~', to.toISOString().slice(0, 19));
console.log('');

const sh = await pool.request()
  .input('from', sql.DateTime, from)
  .input('to', sql.DateTime, to)
  .query(`
    SELECT CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS dt,
           sh.ChangeID, sh.ChangeType,
           c.CustName, sm.OrderWeek, p.ProdName,
           sh.BeforeValue, sh.AfterValue,
           LEFT(ISNULL(sh.Descr,''), 150) AS Descr
      FROM ShipmentHistory sh
      JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE sh.ChangeDtm >= @from AND sh.ChangeDtm < @to
       AND sm.OrderWeek LIKE N'26-%'
       AND ISNULL(sm.isDeleted,0)=0
     ORDER BY sh.ChangeDtm`);

console.log(`[1] ShipmentHistory (분배/출고/견적수량): ${sh.recordset.length}건`);
for (const r of sh.recordset) {
  console.log(`  ${r.dt} | ${r.ChangeID || '-'} | ${r.OrderWeek} | ${r.CustName} | ${r.ProdName}`);
  console.log(`    ${r.ChangeType} ${r.BeforeValue}>${r.AfterValue} ${r.Descr || ''}`);
}

const oh = await pool.request()
  .input('from', sql.DateTime, from)
  .input('to', sql.DateTime, to)
  .query(`
    SELECT CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS dt,
           oh.ChangeID, oh.ChangeType, oh.ColumName,
           c.CustName, om.OrderWeek, p.ProdName,
           oh.BeforeValue, oh.AfterValue,
           LEFT(ISNULL(oh.Descr,''), 150) AS Descr
      FROM OrderHistory oh
      JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
      JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
      LEFT JOIN Customer c ON om.CustKey = c.CustKey
      LEFT JOIN Product p ON od.ProdKey = p.ProdKey
     WHERE oh.ChangeDtm >= @from AND oh.ChangeDtm < @to
       AND om.OrderWeek LIKE N'26-%'
       AND ISNULL(om.isDeleted,0)=0
     ORDER BY oh.ChangeDtm`);

console.log(`\n[2] OrderHistory (주문등록/변경): ${oh.recordset.length}건`);
for (const r of oh.recordset) {
  console.log(`  ${r.dt} | ${r.ChangeID || '-'} | ${r.OrderWeek} | ${r.CustName} | ${r.ProdName}`);
  console.log(`    ${r.ChangeType} ${r.ColumName || ''} ${r.BeforeValue}>${r.AfterValue}`);
}

// ShipmentAdjustment (피벗/조정)
try {
  const adj = await pool.request()
    .input('from', sql.DateTime, from)
    .input('to', sql.DateTime, to)
    .query(`
      SELECT CONVERT(NVARCHAR(19), sa.CreateDtm, 120) AS dt,
             sa.CreateID, sa.OrderWeek, sa.AdjustType, sa.Qty,
             c.CustName, p.ProdName, LEFT(ISNULL(sa.Memo,''), 100) AS Memo
        FROM ShipmentAdjustment sa
        LEFT JOIN Customer c ON sa.CustKey = c.CustKey
        LEFT JOIN Product p ON sa.ProdKey = p.ProdKey
       WHERE sa.CreateDtm >= @from AND sa.CreateDtm < @to
         AND sa.OrderWeek LIKE N'26-%'
       ORDER BY sa.CreateDtm`);
  console.log(`\n[3] ShipmentAdjustment (피벗조정): ${adj.recordset.length}건`);
  for (const r of adj.recordset) {
    console.log(`  ${r.dt} | ${r.CreateID} | ${r.OrderWeek} | ${r.CustName} | ${r.ProdName} | ${r.AdjustType} ${r.Qty}`);
  }
} catch (e) {
  console.log('\n[3] ShipmentAdjustment skip:', e.message);
}

// Estimate — 차감/판매요청 (LastUpdateDtm 또는 CreateDtm)
const estCol = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME = N'Estimate'
     AND COLUMN_NAME IN (N'CreateDtm', N'LastUpdateDtm', N'UpdateDtm', N'ChangeDtm')`);

const dateCol = estCol.recordset[0]?.COLUMN_NAME;
if (dateCol) {
  const est = await pool.request()
    .input('from', sql.DateTime, from)
    .input('to', sql.DateTime, to)
    .query(`
      SELECT CONVERT(NVARCHAR(19), e.${dateCol}, 120) AS dt,
             e.EstimateKey, e.EstimateType, e.Quantity, e.Cost, e.Amount,
             ci.Descr2 AS typeName,
             c.CustName, sm.OrderWeek, p.ProdName,
             LEFT(ISNULL(e.Descr,''), 120) AS Descr
        FROM Estimate e
        JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
        LEFT JOIN Customer c ON sm.CustKey = c.CustKey
        LEFT JOIN Product p ON e.ProdKey = p.ProdKey
        LEFT JOIN CodeInfo ci ON e.EstimateType = ci.CodeValue AND ci.CodeType = N'EstimateType'
       WHERE e.${dateCol} >= @from AND e.${dateCol} < @to
         AND sm.OrderWeek LIKE N'26-%'
         AND ISNULL(sm.isDeleted,0)=0
       ORDER BY e.${dateCol}`);
  console.log(`\n[4] Estimate ${dateCol} (차감/판매요청 등): ${est.recordset.length}건`);
  for (const r of est.recordset) {
    const label = r.typeName || r.EstimateType || '';
    console.log(`  ${r.dt} | ${r.OrderWeek} | ${r.CustName} | ${label} ${r.ProdName || ''}`);
    console.log(`    qty=${r.Quantity} cost=${r.Cost} amt=${r.Amount} ${r.Descr || ''}`);
  }
} else {
  console.log('\n[4] Estimate: 날짜 컬럼 없음 — Descr 타임스탬프로 조회');
  const est = await pool.request().query(`
    SELECT e.EstimateKey, e.EstimateType, e.Quantity, e.Amount, e.Cost,
           c.CustName, sm.OrderWeek, p.ProdName,
           LEFT(ISNULL(e.Descr,''), 150) AS Descr
      FROM Estimate e
      JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON e.ProdKey = p.ProdKey
     WHERE sm.OrderWeek LIKE N'26-%'
       AND ISNULL(sm.isDeleted,0)=0
       AND ISNULL(e.Quantity,0) <> 0
       AND (
         ISNULL(e.Descr,'') LIKE N'%[[]2026-07-02%'
         OR ISNULL(e.Descr,'') LIKE N'%[[]2026-07-03%'
       )
     ORDER BY sm.OrderWeek, c.CustName`);
  console.log(`  Estimate Descr (7/2~7/3): ${est.recordset.length}건`);
  for (const r of est.recordset) {
    console.log(`  ${r.OrderWeek} | ${r.CustName} | type=${r.EstimateType} | ${r.ProdName || ''}`);
    console.log(`    qty=${r.Quantity} amt=${r.Amount} | ${r.Descr || ''}`);
  }
}

const shBiz = sh.recordset.filter((r) => !String(r.ChangeID || '').includes('repair'));

// ── nenova.exe 경로: StockHistory (확정/취소/출고/재고조정)
const stk = await pool.request()
  .input('from', sql.DateTime, from)
  .input('to', sql.DateTime, to)
  .query(`
    SELECT CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS dt,
           sh.ChangeID, sh.ChangeType,
           sh.OrderYear, sh.OrderWeek,
           p.ProdName, p.CounName, p.FlowerName,
           sh.BeforeValue, sh.AfterValue,
           LEFT(ISNULL(sh.Descr,''), 120) AS Descr
      FROM StockHistory sh
      LEFT JOIN Product p ON sh.ProdKey = p.ProdKey
     WHERE sh.ChangeDtm >= @from AND sh.ChangeDtm < @to
       AND (
         sh.OrderWeek LIKE N'26-%'
         OR sh.OrderWeek = N'26'
         OR LEFT(ISNULL(sh.OrderWeek,N''), 2) = N'26'
       )
     ORDER BY sh.ChangeDtm`);

console.log(`\n[6] StockHistory (exe 확정/취소/출고/재고조정): ${stk.recordset.length}건`);
const stkByUser = {};
for (const r of stk.recordset) {
  stkByUser[r.ChangeID || '-'] = (stkByUser[r.ChangeID || '-'] || 0) + 1;
  console.log(`  ${r.dt} | ${r.ChangeID || '-'} | ${r.OrderWeek} | ${r.ChangeType} | ${r.ProdName || r.FlowerName || '-'}`);
  console.log(`    ${r.BeforeValue}>${r.AfterValue} ${r.Descr || ''}`);
}
if (stk.recordset.length) console.log('  [ChangeID별]', stkByUser);

// ShipmentHistory ChangeID별 (exe=admin 등)
const shByUser = {};
for (const r of sh.recordset) {
  shByUser[r.ChangeID || '-'] = (shByUser[r.ChangeID || '-'] || 0) + 1;
}
console.log('\n[1c] ShipmentHistory ChangeID별:', shByUser);

// OrderMaster / ShipmentMaster LastUpdate (exe·웹 공통)
async function probeLastUpdate(table, weekCol, joinSql) {
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = N'${table}'
       AND COLUMN_NAME IN (N'LastUpdateDtm', N'LastUpdateID', N'CreateDtm', N'CreateID')`);
  const names = cols.recordset.map((r) => r.COLUMN_NAME);
  if (!names.includes('LastUpdateDtm')) return [];
  const r = await pool.request()
    .input('from', sql.DateTime, from)
    .input('to', sql.DateTime, to)
    .query(`
      SELECT CONVERT(NVARCHAR(19), t.LastUpdateDtm, 120) AS dt,
             t.LastUpdateID, t.${weekCol} AS OrderWeek,
             c.CustName
        FROM ${table} t
        ${joinSql}
       WHERE t.LastUpdateDtm >= @from AND t.LastUpdateDtm < @to
         AND t.${weekCol} LIKE N'26-%'
         AND ISNULL(t.isDeleted,0)=0
       ORDER BY t.LastUpdateDtm`);
  return r.recordset;
}

const omUpd = await probeLastUpdate(
  'OrderMaster',
  'OrderWeek',
  'LEFT JOIN Customer c ON t.CustKey = c.CustKey',
);
console.log(`\n[7] OrderMaster LastUpdateDtm: ${omUpd.length}건`);
omUpd.slice(0, 30).forEach((r) => console.log(`  ${r.dt} | ${r.LastUpdateID} | ${r.OrderWeek} | ${r.CustName}`));

const smUpd = await probeLastUpdate(
  'ShipmentMaster',
  'OrderWeek',
  'LEFT JOIN Customer c ON t.CustKey = c.CustKey',
);
console.log(`\n[8] ShipmentMaster LastUpdateDtm: ${smUpd.length}건`);
smUpd.slice(0, 30).forEach((r) => console.log(`  ${r.dt} | ${r.LastUpdateID} | ${r.OrderWeek} | ${r.CustName}`));

// ShipmentDetail — LastUpdate 없으면 CreateDtm 스킵; 대신 최근 Detail 행 변경은 History만

// Estimate INSERT/변경 — CreateDtm 있으면
const estCreate = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=N'Estimate'`);
const estCols = new Set(estCreate.recordset.map((r) => r.COLUMN_NAME));
if (estCols.has('CreateDtm')) {
  const estNew = await pool.request()
    .input('from', sql.DateTime, from)
    .input('to', sql.DateTime, to)
    .query(`
      SELECT CONVERT(NVARCHAR(19), e.CreateDtm, 120) AS dt,
             e.EstimateKey, e.EstimateType, e.Quantity, e.Amount,
             c.CustName, sm.OrderWeek, p.ProdName,
             LEFT(ISNULL(e.Descr,''), 100) AS Descr
        FROM Estimate e
        JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
        LEFT JOIN Customer c ON sm.CustKey = c.CustKey
        LEFT JOIN Product p ON e.ProdKey = p.ProdKey
       WHERE e.CreateDtm >= @from AND e.CreateDtm < @to
         AND sm.OrderWeek LIKE N'26-%'
         AND ISNULL(sm.isDeleted,0)=0
       ORDER BY e.CreateDtm`);
  console.log(`\n[9] Estimate CreateDtm (신규 차감/판매요청): ${estNew.recordset.length}건`);
  for (const r of estNew.recordset) {
    console.log(`  ${r.dt} | ${r.OrderWeek} | ${r.CustName} | type=${r.EstimateType} | ${r.ProdName || ''} qty=${r.Quantity} amt=${r.Amount}`);
  }
}

console.log(`\n[1b] ShipmentHistory (repair 제외): ${shBiz.length}건`);
for (const r of shBiz) {
  console.log(`  ${r.dt} | ${r.ChangeID} | ${r.OrderWeek} | ${r.CustName} | ${r.ProdName}`);
  console.log(`    ${r.ChangeType} ${r.BeforeValue}>${r.AfterValue} ${r.Descr || ''}`);
}

// ShipmentDetail Descr 최근 수정 흔적 (웹 분배)
const descr = await pool.request()
  .input('from', sql.DateTime, from)
  .input('to', sql.DateTime, to)
  .query(`
    SELECT sd.SdetailKey, c.CustName, sm.OrderWeek, p.ProdName,
           sd.OutQuantity, LEFT(ISNULL(sd.Descr,''), 200) AS Descr
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE sm.OrderWeek LIKE N'26-%'
       AND ISNULL(sm.isDeleted,0)=0
       AND ISNULL(sd.Descr,'') LIKE N'%[[]20%'
       AND (
         sd.Descr LIKE N'%[[]2026-07-02%'
         OR sd.Descr LIKE N'%[[]2026-07-03%'
       )
     ORDER BY sm.OrderWeek, c.CustName`);

console.log(`\n[5] ShipmentDetail.Descr (7/2~7/3 타임스탬프): ${descr.recordset.length}건`);
for (const r of descr.recordset) {
  console.log(`  ${r.OrderWeek} | ${r.CustName} | ${r.ProdName} | out=${r.OutQuantity}`);
  console.log(`    ${r.Descr}`);
}

const exeBiz = shBiz.length + oh.recordset.length + stk.recordset.length
  + omUpd.length + smUpd.length;
const totalBiz = exeBiz + descr.recordset.length;
console.log('\n=== 요약 (repair·DB복구 제외, exe+웹) ===');
console.log(`ShipmentHistory: ${shBiz.length}`);
console.log(`OrderHistory: ${oh.recordset.length}`);
console.log(`StockHistory (exe SP): ${stk.recordset.length}`);
console.log(`OrderMaster LastUpdate: ${omUpd.length}`);
console.log(`ShipmentMaster LastUpdate: ${smUpd.length}`);
console.log(`ShipmentDetail.Descr 타임스탬프(7/2~7/3): ${descr.recordset.length}`);
console.log(exeBiz === 0 && descr.recordset.length === 0
  ? '→ 목요일(7/2)~오늘(7/3) 26차 분배·주문·차감·확정 변경 없음 (웹+exe 이력 기준)'
  : '→ 위 목록 참고');
console.log('\n=== 참고: repair-script 이력 ===');
console.log(`ShipmentHistory repair: ${sh.recordset.length - shBiz.length}건 (희경 현지상차운임 금액동기화)`);

await pool.close();
