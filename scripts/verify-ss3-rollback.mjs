#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

// 남은 주문 라인 (28-01, 대상 거래처)
const custs = await pool.request().query(`SELECT CustKey FROM Customer WHERE CustName LIKE N'%라움%'`);
const raumKey = custs.recordset[0]?.CustKey;

const raum = await pool.request().query(`
  SELECT p.ProdName, od.OutQuantity, ISNULL(od.isDeleted,0) AS del
    FROM OrderDetail od JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
    LEFT JOIN Product p ON od.ProdKey=p.ProdKey
   WHERE om.OrderWeek='28-01' AND om.CustKey=${raumKey} AND ISNULL(od.isDeleted,0)=0`);
console.log('=== 라움 28-01 남은 주문 라인 ===');
if (!raum.recordset.length) console.log('  (없음)');
for (const r of raum.recordset) console.log(`  ${(r.ProdName||'').slice(0,30)} = ${r.OutQuantity}`);

// 라움 분배 남은 것
const raumShip = await pool.request().query(`
  SELECT p.ProdName, sd.OutQuantity
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
    LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
   WHERE sm.OrderWeek='28-01' AND sm.CustKey=${raumKey} AND ISNULL(sm.isDeleted,0)=0`);
console.log('\n=== 라움 28-01 남은 분배 라인 ===');
if (!raumShip.recordset.length) console.log('  (없음)');
for (const r of raumShip.recordset) console.log(`  ${(r.ProdName||'').slice(0,30)} = ${r.OutQuantity}`);

// 롤백 이력 건수
const rb = await pool.request().query(`
  SELECT COUNT(*) AS c FROM OrderHistory WHERE ChangeID='rollback-ss3'`);
const rbs = await pool.request().query(`
  SELECT COUNT(*) AS c FROM ShipmentHistory WHERE ChangeID='rollback-ss3'`);
console.log(`\n롤백 이력: OrderHistory ${rb.recordset[0].c}건 / ShipmentHistory ${rbs.recordset[0].c}건`);

// 28-01 전체 재집계
const tot = await pool.request().query(`
  SELECT COUNT(DISTINCT om.OrderMasterKey) AS masters, COUNT(*) AS lines, SUM(od.OutQuantity) AS qty
    FROM OrderDetail od JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
   WHERE om.OrderWeek='28-01' AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0`);
console.log('\n=== 28-01 전체 (롤백 후) ===');
console.log(tot.recordset[0]);

// 잔존 SS3 delta(7/2) 확인
const leftover = await pool.request().query(`
  SELECT COUNT(*) AS c
    FROM OrderDetail od JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
   WHERE om.OrderWeek='28-01' AND ISNULL(od.isDeleted,0)=0 AND od.LastUpdateID='nenovaSS3'`);
console.log(`\n남은 LastUpdateID=nenovaSS3 (28-01 활성 주문): ${leftover.recordset[0].c}건`);

await pool.close();
