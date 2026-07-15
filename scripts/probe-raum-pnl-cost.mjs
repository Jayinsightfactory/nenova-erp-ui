#!/usr/bin/env node
// 라움 손익계산서 기능 설계용 읽기전용 probe
// 1) 라움 거래처 목록  2) 27차 분배(ShipmentDetail) 품목별 수량/저장Amount→단가  3) 견적서 품목명 매칭 확인
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

const custs = await pool.request().query(`
  SELECT CustKey, CustName, CustArea FROM Customer
   WHERE isDeleted = 0 AND (CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')
   ORDER BY CustName`);
console.log('=== 라움/트라움 거래처 ===');
for (const c of custs.recordset) console.log(c.CustKey, '|', c.CustName, '|', c.CustArea || '');

const ckList = custs.recordset.map(c => c.CustKey).join(',');
if (!ckList) { console.log('거래처 없음'); await pool.close(); process.exit(0); }

// 27차 분배 상세: 품목별 수량/금액 (저장 Amount 기준, isFix 무관하게 먼저 전체 확인)
const rows = await pool.request().query(`
  SELECT c.CustName, sm.OrderWeek, sm.isFix,
         p.ProdKey, p.ProdName, p.FlowerName, p.OutUnit,
         SUM(sd.OutQuantity) AS OutQty, SUM(sd.EstQuantity) AS EstQty,
         SUM(sd.Amount) AS Amt, SUM(ISNULL(sd.Cost,0)) AS CostSum
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE ISNULL(sm.isDeleted,0) = 0
     AND sm.CustKey IN (${ckList})
     AND sm.OrderWeek LIKE '27-%'
   GROUP BY c.CustName, sm.OrderWeek, sm.isFix, p.ProdKey, p.ProdName, p.FlowerName, p.OutUnit
   ORDER BY c.CustName, p.ProdName`);
console.log(`\n=== 27차 라움 분배 상세 (${rows.recordset.length}행) ===`);
for (const r of rows.recordset) {
  const unitAmt = r.EstQty ? (r.Amt / r.EstQty) : null;
  const unitOut = r.OutQty ? (r.Amt / r.OutQty) : null;
  console.log(
    `${r.CustName} ${r.OrderWeek} fix=${r.isFix} | ${(r.ProdName||'?').slice(0,38).padEnd(40)} | Out=${r.OutQty} Est=${r.EstQty} | Amt=${r.Amt} | 단가(Est)=${unitAmt?.toFixed(0)} 단가(Out)=${unitOut?.toFixed(0)} | Cost=${r.CostSum}`
  );
}

// 26차도 참고 (견적서에 6월 적요 품목 존재)
const rows26 = await pool.request().query(`
  SELECT sm.OrderWeek, COUNT(*) AS lineCnt, SUM(sd.Amount) AS Amt
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
   WHERE ISNULL(sm.isDeleted,0) = 0 AND sm.CustKey IN (${ckList})
     AND (sm.OrderWeek LIKE '2%-%')
   GROUP BY sm.OrderWeek ORDER BY sm.OrderWeek`);
console.log('\n=== 차수별 라움 분배 라인수/금액 ===');
for (const r of rows26.recordset) console.log(r.OrderWeek, '| lines=', r.lineCnt, '| Amt=', r.Amt);

await pool.close();
