/**
 * 25차 미카엘 견적 비고(Descr) 진단 — exe 인쇄 적요 확인용
 * node scripts/probe-estimate-descr-25-michael.mjs
 */
import { query } from '../lib/db.js';
import { isOperationalEstimateDescr } from '../lib/estimateInvariants.js';

const custLike = process.argv[2] || '%미카엘%';
const weekLike = process.argv[3] || '25-%';

const ship = await query(
  `SELECT TOP 50 sm.ShipmentKey, sm.OrderWeek, c.CustName, c.CustKey,
          p.ProdName, sd.SdetailKey, sd.OutQuantity, ISNULL(sd.Descr,'') AS Descr
   FROM ShipmentMaster sm
   JOIN Customer c ON c.CustKey = sm.CustKey
   JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
   JOIN Product p ON p.ProdKey = sd.ProdKey
   WHERE sm.OrderWeek LIKE @wk AND c.CustName LIKE @cust
     AND ISNULL(sd.Descr,'') <> ''
   ORDER BY sm.OrderWeek, p.ProdName`,
  { wk: { type: 'NVarChar', value: weekLike }, cust: { type: 'NVarChar', value: custLike } }
);

const est = await query(
  `SELECT TOP 30 e.EstimateKey, sm.OrderWeek, c.CustName,
          p.ProdName, e.EstimateType, e.Quantity, ISNULL(e.Descr,'') AS Descr
   FROM Estimate e
   JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
   JOIN Customer c ON c.CustKey = sm.CustKey
   JOIN Product p ON p.ProdKey = e.ProdKey
   WHERE sm.OrderWeek LIKE @wk AND c.CustName LIKE @cust
     AND ISNULL(e.Descr,'') <> ''
   ORDER BY sm.OrderWeek, p.ProdName`,
  { wk: { type: 'NVarChar', value: weekLike }, cust: { type: 'NVarChar', value: custLike } }
);

console.log(`=== ShipmentDetail.Descr (${weekLike} / ${custLike}) — ${ship.recordset.length}건 ===\n`);
for (const row of ship.recordset) {
  const d = String(row.Descr || '').replace(/\r?\n/g, ' | ');
  const op = isOperationalEstimateDescr(d) ? ' [운영로그]' : ' [메모]';
  console.log(`[${row.OrderWeek}] SK=${row.ShipmentKey} ${row.ProdName?.slice(0, 40)}${op}`);
  console.log(`  ${JSON.stringify(d.slice(0, 160))}`);
}

console.log(`\n=== Estimate.Descr — ${est.recordset.length}건 ===\n`);
for (const row of est.recordset) {
  const d = String(row.Descr || '').replace(/\r?\n/g, ' | ');
  const op = isOperationalEstimateDescr(d) ? ' [운영로그]' : ' [메모]';
  console.log(`[${row.OrderWeek}] ${row.EstimateType} ${row.ProdName?.slice(0, 40)} qty=${row.Quantity}${op}`);
  console.log(`  ${JSON.stringify(d.slice(0, 160))}`);
}

process.exit(0);
