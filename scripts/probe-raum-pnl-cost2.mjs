#!/usr/bin/env node
// 라움 손익 매입단가 원천 검증 probe #2 (읽기전용)
// A) 28차 라움 분배(기존 수기 손익 1차(7/8)와 대조)  B) 해당 품목 Product.Cost / WebStockPrice
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

const q28 = await pool.request().query(`
  SELECT sm.OrderWeek, p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
         SUM(sd.OutQuantity) AS OutQty, SUM(sd.EstQuantity) AS EstQty, SUM(sd.Amount) AS Amt,
         MAX(ISNULL(p.Cost,0)) AS ProdCost, MAX(sp.Price) AS SetPrice,
         MAX(CASE WHEN ISNULL(p.SteamOf1Box,0)>0 THEN p.SteamOf1Box WHEN ISNULL(p.BunchOf1Box,0)>0 THEN p.BunchOf1Box ELSE 1 END) AS UnitPerBox
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
    LEFT JOIN WebStockPrice sp ON sp.ProdKey = p.ProdKey
   WHERE ISNULL(sm.isDeleted,0)=0 AND sm.CustKey = 680 AND sm.OrderWeek LIKE '28-%'
   GROUP BY sm.OrderWeek, p.ProdKey, p.ProdName, p.FlowerName, p.CounName
   ORDER BY sm.OrderWeek, p.ProdName`);
console.log(`=== 28차 라움 분배 (${q28.recordset.length}행) — 수기 손익 1차(7/8)와 대조용 ===`);
for (const r of q28.recordset) {
  const unit = r.EstQty ? (r.Amt / r.EstQty) : null;
  console.log(`${r.OrderWeek} | ${(r.ProdName||'?').slice(0,42).padEnd(44)} | Est=${r.EstQty} | 매출단가=${unit?.toFixed(0)} | Product.Cost=${r.ProdCost} | 지정=${r.SetPrice ?? '-'}`);
}

// 27차 라움 품목의 Product.Cost도
const q27 = await pool.request().query(`
  SELECT DISTINCT p.ProdKey, p.ProdName, ISNULL(p.Cost,0) AS ProdCost, sp.Price AS SetPrice,
         p.CounName, p.FlowerName
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
    LEFT JOIN WebStockPrice sp ON sp.ProdKey = p.ProdKey
   WHERE ISNULL(sm.isDeleted,0)=0 AND sm.CustKey = 680 AND sm.OrderWeek LIKE '27-%'
   ORDER BY p.ProdName`);
console.log(`\n=== 27차 라움 품목 Product.Cost / 지정단가 ===`);
for (const r of q27.recordset) {
  console.log(`${(r.ProdName||'?').slice(0,44).padEnd(46)} | Cost=${r.ProdCost} | 지정=${r.SetPrice ?? '-'} | ${r.CounName||''}/${r.FlowerName||''}`);
}

// CustomerProdCost 존재 여부 (거래처별 단가)
try {
  const cpc = await pool.request().query(`
    SELECT TOP 20 cpc.ProdKey, p.ProdName, cpc.* FROM CustomerProdCost cpc
    LEFT JOIN Product p ON cpc.ProdKey=p.ProdKey WHERE cpc.CustKey=680`);
  console.log(`\n=== CustomerProdCost (CustKey=680) ${cpc.recordset.length}건 ===`);
  for (const r of cpc.recordset.slice(0, 20)) console.log(JSON.stringify(r));
} catch (e) { console.log('\nCustomerProdCost 조회 실패:', e.message); }

await pool.close();
