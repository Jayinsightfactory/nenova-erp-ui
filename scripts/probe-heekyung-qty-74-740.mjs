#!/usr/bin/env node
/** 희경 현지상차 SdetailKey=79257 — 수량 74↔740 변경 시점 추적 (KST) */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDKEY = parseInt(process.argv[2] || '79257', 10);

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function kst(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
});

console.log(`=== SdetailKey=${SDKEY} 수량 변경 추적 (KST) ===\n`);

const snap = await pool.request().input('sk', sql.Int, SDKEY).query(`
  SELECT sd.SdetailKey, sd.OutQuantity, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
         sd.Amount, sd.Vat, sd.Cost, sd.Descr AS detailDescr,
         sm.OrderWeek, sm.OrderYear, sm.ShipmentKey, c.CustName, p.ProdName, p.ProdKey,
         sm.LastUpdateID, sm.LastUpdateDtm
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE sd.SdetailKey = @sk`);
console.log('【현재 ShipmentDetail】');
console.log(snap.recordset[0]);

const sh = await pool.request().input('sk', sql.Int, SDKEY).query(`
  SELECT sh.HistoryKey, sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr, sh.ShipmentDtm
    FROM ShipmentHistory sh
   WHERE sh.SdetailKey = @sk
   ORDER BY sh.ChangeDtm ASC`);
console.log(`\n【ShipmentHistory 전체 ${sh.recordset.length}건】`);
for (const r of sh.recordset) {
  const b = num(r.BeforeValue);
  const a = num(r.AfterValue);
  const qtyHit = (b === 74 && a === 740) || (b === 740 && a === 74) || a === 740 || b === 740;
  const flag = qtyHit ? ' ★★★' : '';
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${r.BeforeValue} → ${r.AfterValue} | ${r.Descr || '-'}${flag}`);
}

const qtyChanges = sh.recordset.filter((r) => {
  const b = num(r.BeforeValue);
  const a = num(r.AfterValue);
  return b != null && a != null && Math.abs(a - b) > 0.001;
});
console.log(`\n【수량/값 변경 이력 (Before≠After) ${qtyChanges.length}건】`);
for (const r of qtyChanges) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.BeforeValue} → ${r.AfterValue} | ${r.Descr || '-'}`);
}

const hit740 = qtyChanges.filter((r) => {
  const b = num(r.BeforeValue);
  const a = num(r.AfterValue);
  return (b === 74 && a === 740) || (b === 740 && a === 74) || a === 740 || b === 740;
});
console.log(`\n【74↔740 관련 ${hit740.length}건】`);
for (const r of hit740) {
  console.log(`>>> ${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.BeforeValue} → ${r.AfterValue} | ${r.Descr}`);
}

// OrderHistory via shipment
const oh = await pool.request().input('sk', sql.Int, SDKEY).query(`
  SELECT oh.ChangeDtm, oh.ChangeID, oh.BeforeValue, oh.AfterValue, oh.Descr,
         om.OrderWeek, c.CustName, p.ProdName, od.OrderDetailKey
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN ShipmentDetail sd ON sd.ProdKey = od.ProdKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.CustKey = om.CustKey AND sm.OrderWeek = om.OrderWeek
    LEFT JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE sd.SdetailKey = @sk
   ORDER BY oh.ChangeDtm ASC`);
console.log(`\n【OrderHistory (연결) ${oh.recordset.length}건】`);
for (const r of oh.recordset) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.BeforeValue} → ${r.AfterValue} | ${r.Descr || '-'}`);
}

// ShipmentDate rows
const sdd = await pool.request().input('sk', sql.Int, SDKEY).query(`
  SELECT sdd.ShipmentDateKey, sdd.ShipmentDtm, sdd.BoxQuantity, sdd.BunchQuantity, sdd.SteamQuantity,
         sdd.OutQuantity, sdd.Amount, sdd.Vat, sdd.Descr,
         sdd.CreateID, sdd.CreateDtm, sdd.LastUpdateID, sdd.LastUpdateDtm
    FROM ShipmentDate sdd
   WHERE sdd.SdetailKey = @sk
   ORDER BY sdd.ShipmentDtm`);
console.log(`\n【ShipmentDate ${sdd.recordset.length}건】`);
for (const r of sdd.recordset) {
  console.log(`${kst(r.ShipmentDtm)} | Out=${r.OutQuantity} Box=${r.BoxQuantity} Amt=${r.Amount} | ${r.Descr || ''} | upd=${r.LastUpdateID} ${kst(r.LastUpdateDtm)}`);
}

// AppLog
for (const tbl of ['AppLog', 'ActionLog']) {
  try {
    const log = await pool.request().input('sk', sql.Int, SDKEY).query(`
      SELECT TOP 100 * FROM ${tbl}
       WHERE CAST(${tbl === 'AppLog' ? 'Detail' : 'Detail'} AS NVARCHAR(MAX)) LIKE '%' + CAST(@sk AS NVARCHAR) + '%'
          OR CAST(${tbl === 'AppLog' ? 'Detail' : 'Detail'} AS NVARCHAR(MAX)) LIKE N'%740%'
          OR CAST(${tbl === 'AppLog' ? 'Detail' : 'Detail'} AS NVARCHAR(MAX)) LIKE N'%79257%'
       ORDER BY ${tbl === 'AppLog' ? 'CreateDtm' : 'CreateDtm'} DESC
    `);
    if (log.recordset.length) {
      console.log(`\n【${tbl}】`);
      for (const r of log.recordset) {
        const dt = r.CreateDtm || r.ChangeDtm;
        console.log(`${kst(dt)} | ${r.Category || ''} ${r.Step || ''} | ${String(r.Detail || '').slice(0, 200)}`);
      }
    }
  } catch { /* */ }
}

// Broader search: any ShipmentHistory 74→740 for 희경
const broad = await pool.request().query(`
  SELECT sh.ChangeDtm, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr,
         sh.SdetailKey, c.CustName, p.ProdName, sm.OrderWeek
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE c.CustName LIKE N'%희경%'
     AND (
       (TRY_CAST(sh.BeforeValue AS FLOAT) = 74 AND TRY_CAST(sh.AfterValue AS FLOAT) = 740)
       OR (TRY_CAST(sh.BeforeValue AS FLOAT) = 740 AND TRY_CAST(sh.AfterValue AS FLOAT) = 74)
       OR TRY_CAST(sh.AfterValue AS FLOAT) = 740
       OR TRY_CAST(sh.BeforeValue AS FLOAT) = 740
     )
   ORDER BY sh.ChangeDtm DESC`);
console.log(`\n【희경 전체 74/740 ShipmentHistory ${broad.recordset.length}건】`);
for (const r of broad.recordset) {
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | sk=${r.SdetailKey} | ${r.OrderWeek} | ${r.ProdName} | ${r.BeforeValue}→${r.AfterValue} | ${r.Descr}`);
}

// ShipmentDetail Descr timestamps
const descr = await pool.request().input('sk', sql.Int, SDKEY).query(`
  SELECT sd.Descr FROM ShipmentDetail sd WHERE sd.SdetailKey = @sk`);
console.log('\n【ShipmentDetail.Descr】');
console.log(descr.recordset[0]?.Descr || '(empty)');

await pool.close();
