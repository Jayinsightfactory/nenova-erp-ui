#!/usr/bin/env node
/**
 * 카네이션: 주문(OrderDetail) vs 실제분배(ShipmentDetail) 업체별 대조
 *   node scripts/diag-carnation-week.mjs [week]
 */
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

const WEEK = process.argv[2] || '28-01';
const CARN = `(p.FlowerName LIKE '%CARNATION%' OR p.FlowerName LIKE '%카네%' OR p.ProdName LIKE '%CARNATION%' OR p.ProdName LIKE '%카네%')`;

// 주문
const ord = await pool.request().query(`
  SELECT c.CustKey, c.CustName, p.ProdKey, p.ProdName,
         SUM(od.OutQuantity) AS ordOut
    FROM OrderDetail od
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
    JOIN Product  p ON od.ProdKey = p.ProdKey
   WHERE om.OrderWeek = '${WEEK}' AND ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0
     AND ${CARN}
   GROUP BY c.CustKey, c.CustName, p.ProdKey, p.ProdName`);

// 분배 (마스터 isDeleted=0)
const dist = await pool.request().query(`
  SELECT c.CustKey, c.CustName, p.ProdKey, p.ProdName,
         SUM(sd.OutQuantity) AS distOut, COUNT(*) AS nDet,
         ISNULL(sm.isFix,0) AS isFix
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON sm.CustKey = c.CustKey
    JOIN Product  p ON sd.ProdKey = p.ProdKey
   WHERE sm.OrderWeek = '${WEEK}' AND ISNULL(sm.isDeleted,0)=0
     AND ${CARN}
   GROUP BY c.CustKey, c.CustName, p.ProdKey, p.ProdName, ISNULL(sm.isFix,0)`);

const key = (r) => `${r.CustKey}::${r.ProdKey}`;
const rows = new Map();
for (const r of ord.recordset) {
  rows.set(key(r), { CustName: r.CustName, ProdName: r.ProdName, ord: Number(r.ordOut), dist: 0, nDet: 0, fix: 0 });
}
for (const r of dist.recordset) {
  const k = key(r);
  if (!rows.has(k)) rows.set(k, { CustName: r.CustName, ProdName: r.ProdName, ord: 0, dist: 0, nDet: 0, fix: 0 });
  const e = rows.get(k);
  e.dist += Number(r.distOut); e.nDet += Number(r.nDet); if (r.isFix) e.fix = 1;
}

const list = [...rows.values()].sort((a, b) => (a.CustName || '').localeCompare(b.CustName || '') || (a.ProdName || '').localeCompare(b.ProdName || ''));
let tOrd = 0, tDist = 0, missing = 0, under = 0, over = 0;
console.log(`\n=== ${WEEK} 카네이션  주문 vs 분배 (박스 OutQuantity) ===`);
console.log('업체 | 품목 | 주문 | 분배 | 차이 | 상태');
console.log('-'.repeat(100));
for (const e of list) {
  tOrd += e.ord; tDist += e.dist;
  const diff = e.dist - e.ord;
  let st = 'OK';
  if (e.ord > 0 && e.dist === 0) { st = '❌미분배'; missing++; }
  else if (diff < -0.001) { st = '▼덜됨'; under++; }
  else if (diff > 0.001 && e.ord > 0) { st = '▲초과'; over++; }
  else if (e.ord === 0 && e.dist > 0) { st = '⚠주문無분배有'; over++; }
  if (st === 'OK') continue; // 문제행만 출력
  console.log(`${(e.CustName||'').slice(0,16).padEnd(17)} | ${(e.ProdName||'').slice(0,26).padEnd(27)} | ${String(e.ord).padStart(4)} | ${String(e.dist).padStart(4)} | ${String(diff).padStart(4)} | ${st}${e.fix?' [확정]':''}`);
}
console.log('-'.repeat(100));
console.log(`합계  주문=${tOrd}  분배=${tDist}  (분배-주문=${tDist - tOrd})`);
console.log(`문제  미분배(업체통째)=${missing}건  덜됨=${under}건  초과/주문無=${over}건`);

// 업체별 미분배 요약
const byCust = new Map();
for (const e of list) {
  if (!(e.ord > 0 && e.dist === 0)) continue;
  byCust.set(e.CustName, (byCust.get(e.CustName) || 0) + e.ord);
}
if (byCust.size) {
  console.log(`\n=== 통째로 미분배된 업체 (주문 있는데 분배 0) ===`);
  for (const [name, q] of [...byCust.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${name.padEnd(18)} 주문 ${q}박스`);
  }
}
await pool.close();
