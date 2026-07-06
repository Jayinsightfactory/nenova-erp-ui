#!/usr/bin/env node
/** 26차 전체 — 매출 영향 ~20만원(15만~25만) 작업 역추적 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] || '26';
const LO = Number(process.argv[3] || 150000);
const HI = Number(process.argv[4] || 250000);

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function roundAmt(gross) {
  return Math.round(Number(gross) / 1.1);
}
function grossFromQtyCost(qty, cost) {
  return Number(qty) * Number(cost);
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
});

const parentFilter = `LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) = N'${PW}'`;

// 현재 화면별 합계
const screens = await pool.request().query(`
  SELECT
    SUM(CASE WHEN sm.isFix=1 THEN sd.Amount ELSE 0 END) AS detailAmtFix,
    SUM(sd.Amount) AS detailAmtAll,
    SUM(CASE WHEN sm.isFix=1 THEN ISNULL(da.dateAmt,0) ELSE 0 END) AS dateAmtFix,
    SUM(CASE WHEN sm.isFix=1 THEN sd.Amount+sd.Vat ELSE 0 END) AS detailGrossFix,
    SUM(CASE WHEN sm.isFix=1 THEN ISNULL(da.dateGross,0) ELSE 0 END) AS dateGrossFix
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  OUTER APPLY (
    SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt, SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) dateGross
    FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey
  ) da
  WHERE sm.isDeleted=0 AND ${parentFilter}`);
console.log('=== 현재 26차 화면 합계 ===');
console.log(screens.recordset[0]);
const s = screens.recordset[0];
console.log('Detail vs Date Amount gap:', Number(s.detailAmtFix) - Number(s.dateAmtFix));
console.log('Detail vs Date gross gap:', Number(s.detailGrossFix) - Number(s.dateGrossFix));

// ShipmentHistory 수량 변경 → 추정 매출 영향
const sh = await pool.request().query(`
  SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
         sh.SdetailKey, c.CustName, sm.OrderWeek, p.ProdName,
         sd.Cost, sd.Amount AS curAmount, sd.OutQuantity AS curOut
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE ${parentFilter.replace(/sm\./g, 'sm.')}
     AND ISNULL(sm.isDeleted,0)=0
     AND sh.BeforeValue IS NOT NULL AND sh.AfterValue IS NOT NULL
     AND TRY_CAST(sh.BeforeValue AS FLOAT) IS NOT NULL
     AND TRY_CAST(sh.AfterValue AS FLOAT) IS NOT NULL
     AND ABS(TRY_CAST(sh.AfterValue AS FLOAT) - TRY_CAST(sh.BeforeValue AS FLOAT)) > 0.0001
   ORDER BY sh.ChangeDtm`);

const shImpacts = [];
for (const r of sh.recordset) {
  const b = Number(r.BeforeValue);
  const a = Number(r.AfterValue);
  const dq = a - b;
  const cost = Number(r.Cost || 0);
  const amtDelta = roundAmt(grossFromQtyCost(dq, cost));
  const grossDelta = grossFromQtyCost(dq, cost);
  shImpacts.push({
    kind: 'ShipmentHistory',
    dt: r.ChangeDtm,
    user: r.ChangeID,
    type: r.ChangeType,
    week: r.OrderWeek,
    cust: r.CustName,
    prod: r.ProdName,
    sdetailKey: r.SdetailKey,
    before: b,
    after: a,
    dq,
    cost,
    amtDelta,
    grossDelta,
    descr: r.Descr,
    curAmount: r.curAmount,
  });
}

// EstimateHistory (차감)
let eh = { recordset: [] };
try {
  eh = await pool.request().query(`
    SELECT eh.ChangeDtm, eh.ChangeID, eh.ChangeType, eh.BeforeValue, eh.AfterValue, eh.Descr,
           e.EstimateKey, e.EstimateType, e.Amount AS curAmt, e.Cost,
           c.CustName, sm.OrderWeek, p.ProdName
      FROM EstimateHistory eh
      JOIN Estimate e ON eh.EstimateKey = e.EstimateKey
      JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
      LEFT JOIN Customer c ON sm.CustKey = c.CustKey
      LEFT JOIN Product p ON e.ProdKey = p.ProdKey
     WHERE ${parentFilter.replace(/sm\./g, 'sm.')}
       AND ISNULL(sm.isDeleted,0)=0
     ORDER BY eh.ChangeDtm`);
} catch (e) {
  console.log('EstimateHistory skip:', e.message?.slice(0, 80));
}

const estImpacts = [];
for (const r of eh.recordset) {
  const b = Number(r.BeforeValue);
  const a = Number(r.AfterValue);
  if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
  const delta = a - b;
  if (Math.abs(delta) < 1) continue;
  estImpacts.push({
    kind: 'EstimateHistory',
    dt: r.ChangeDtm,
    user: r.ChangeID,
    type: r.ChangeType,
    week: r.OrderWeek,
    cust: r.CustName,
    prod: r.ProdName,
    estType: r.EstimateType,
    before: b,
    after: a,
    amtDelta: delta,
    descr: r.Descr,
    curAmt: r.curAmt,
  });
}

// OrderHistory → 간접 (주문수량 변경, 분배 전)
const oh = await pool.request().query(`
  SELECT oh.ChangeDtm, oh.ChangeID, oh.ChangeType, oh.ColumName,
         oh.BeforeValue, oh.AfterValue, oh.Descr,
         c.CustName, om.OrderWeek, p.ProdName, ISNULL(p.Cost,0) AS Cost
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    LEFT JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE LEFT(om.OrderWeek, CHARINDEX('-', om.OrderWeek + '-') - 1) = N'${PW}'
     AND ISNULL(om.isDeleted,0)=0
     AND oh.ColumName IN (N'BoxQuantity', N'BunchQuantity', N'SteamQuantity', N'OutQuantity', N'Cost', N'Amount')
     AND TRY_CAST(oh.BeforeValue AS FLOAT) IS NOT NULL
     AND TRY_CAST(oh.AfterValue AS FLOAT) IS NOT NULL
     AND ABS(TRY_CAST(oh.AfterValue AS FLOAT) - TRY_CAST(oh.BeforeValue AS FLOAT)) > 0.0001
   ORDER BY oh.ChangeDtm`);

const ohImpacts = [];
for (const r of oh.recordset) {
  const b = Number(r.BeforeValue);
  const a = Number(r.AfterValue);
  const dq = a - b;
  const cost = Number(r.Cost || 0);
  let amtDelta = 0;
  if (r.ColumName === 'Amount') amtDelta = dq;
  else if (r.ColumName === 'Cost') amtDelta = 0; // skip cost-only
  else amtDelta = roundAmt(grossFromQtyCost(dq, cost));
  ohImpacts.push({
    kind: 'OrderHistory',
    dt: r.ChangeDtm,
    user: r.ChangeID,
    type: r.ChangeType,
    col: r.ColumName,
    week: r.OrderWeek,
    cust: r.CustName,
    prod: r.ProdName,
    before: b,
    after: a,
    amtDelta,
    descr: r.Descr,
  });
}

function inBand(x) {
  const a = Math.abs(Number(x));
  return a >= LO && a <= HI;
}

function printHits(label, rows, field = 'amtDelta') {
  const hits = rows.filter((r) => inBand(r[field]));
  console.log(`\n=== ${label}: |${field}| ${LO.toLocaleString()}~${HI.toLocaleString()} (${hits.length}건) ===`);
  hits.sort((x, y) => Math.abs(y[field]) - Math.abs(x[field]));
  for (const r of hits.slice(0, 30)) {
    const dt = r.dt?.toISOString?.().slice(0, 19) || r.dt;
    console.log(`\n${dt} | ${r.user || '-'} | ${r.kind} | ${r.week} | ${r.cust}`);
    console.log(`  ${r.prod?.slice?.(0, 60) || r.prod}`);
    if (r.sdetailKey) console.log(`  SdetailKey=${r.sdetailKey} ${r.type} qty ${r.before}→${r.after} (Δ${r.dq}) cost=${r.cost}`);
    if (r.estType) console.log(`  Estimate ${r.estType} ${r.before}→${r.after}`);
    if (r.col) console.log(`  ${r.col} ${r.before}→${r.after}`);
    console.log(`  추정 매출(공급가) Δ=${r[field]?.toLocaleString?.() || r[field]} ${r.descr ? '| ' + String(r.descr).slice(0, 80) : ''}`);
  }
  return hits;
}

printHits('분배/출고 이력', shImpacts);
printHits('차감 이력', estImpacts);
printHits('주문 이력', ohImpacts);

// 누적: 같은 SdetailKey에서 repair 전후 Detail-Date gap이 20만이었는지 (희경)
const hee = await pool.request().query(`
  SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
         sd.SdetailKey, c.CustName, p.ProdName, sd.Cost, sd.Amount, sd.OutQuantity
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE sd.SdetailKey = 79257
   ORDER BY sh.ChangeDtm`);
console.log('\n=== 희경 79257 전체 이력 ===');
for (const r of hee.recordset) {
  console.log(r.ChangeDtm?.toISOString?.().slice(0, 19), r.ChangeID, r.ChangeType, r.BeforeValue, '→', r.AfterValue, r.Descr || '');
}

// 상위 수량변경 (전체, 20만 밴드 밖도)
console.log('\n=== ShipmentHistory 수량변경 TOP 20 (절대 매출영향) ===');
shImpacts.sort((a, b) => Math.abs(b.amtDelta) - Math.abs(a.amtDelta));
for (const r of shImpacts.slice(0, 20)) {
  console.log(
    `${r.dt?.toISOString?.().slice(0, 10)} | ${r.user} | ${r.cust} | Δqty=${r.dq} | Δamt=${r.amtDelta.toLocaleString()} | ${r.prod?.slice(0, 40)} | sk=${r.sdetailKey}`
  );
}

// 26-01 vs 26-02 합계 차이가 아닌, 서브차수별 견적 vs 매출
const sub = await pool.request().query(`
  SELECT sm.OrderWeek,
    SUM(sd.Amount) detailAmt,
    SUM(ISNULL(da.dateAmt,0)) dateAmt,
    SUM(sd.Amount - ISNULL(da.dateAmt,0)) gap
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
  OUTER APPLY (SELECT SUM(ISNULL(sdd.Amount,0)) dateAmt FROM ShipmentDate sdd WHERE sdd.SdetailKey=sd.SdetailKey) da
  WHERE sm.isDeleted=0 AND sm.isFix=1 AND ${parentFilter}
  GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek`);
console.log('\n=== 서브차수별 Detail vs Date ===');
console.log(sub.recordset);

// Estimate 차감 합 — 타입별
const est = await pool.request().query(`
  SELECT e.EstimateType, SUM(e.Amount) amt, SUM(e.Vat) vat
  FROM Estimate e
  JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
  WHERE sm.isDeleted=0 AND ${parentFilter}
  GROUP BY e.EstimateType`);
console.log('\n=== Estimate 타입별 (26차) ===');
console.log(est.recordset);

await pool.close();
