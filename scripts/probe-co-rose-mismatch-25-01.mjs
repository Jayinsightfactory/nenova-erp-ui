import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const week = '25-01';

const rows = await query(
  `SELECT c.CustName, p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS B1B,
          ISNULL(od.OutQuantity,0) AS orderOut,
          ISNULL(od.BoxQuantity,0) AS orderBox,
          ISNULL(od.BunchQuantity,0) AS orderBunch,
          ISNULL(sd.OutQuantity,0) AS shipOut,
          ISNULL(sd.BoxQuantity,0) AS shipBox,
          ISNULL(sd.BunchQuantity,0) AS shipBunch,
          ISNULL(sd.Descr,'') AS shipDescr
   FROM ShipmentDetail sd
   JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey AND sm.isDeleted=0
   JOIN Customer c ON sm.CustKey=c.CustKey
   JOIN Product p ON sd.ProdKey=p.ProdKey AND p.isDeleted=0
   LEFT JOIN OrderMaster om ON om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND om.isDeleted=0
   LEFT JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=sd.ProdKey AND od.isDeleted=0
   WHERE sm.OrderWeek=@wk AND sd.OutQuantity>0
     AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미'
   ORDER BY c.CustName, p.ProdName`,
  { wk: { type: sql.NVarChar, value: week } },
);

console.log(`=== ${week} CO rose shipment vs order mismatch ===\n`);

const mismatches = [];
for (const r of rows.recordset) {
  const b1b = Number(r.B1B) || 1;
  const orderBunch = Number(r.orderBunch) || Number(r.orderOut) || 0;
  const orderBox = Number(r.orderBox) || 0;
  const shipOut = Number(r.shipOut);
  const shipBunch = Number(r.shipBunch);

  // 주문 대비 분배 불일치
  if (orderBunch > 0 && Math.abs(shipOut - orderBunch) > 0.01) {
    mismatches.push({ ...r, kind: 'SHIP≠ORDER_BUNCH', orderBunch, shipOut, diff: shipOut - orderBunch });
  }

  // OutQuantity가 주문 BoxQuantity와 같고 Bunch는 B1B배 (박스를 단 Out에)
  if (orderBunch > 0 && b1b > 1 && Math.abs(shipOut - orderBox) < 0.01 && Math.abs(orderBunch - shipOut * b1b) < 0.51) {
    mismatches.push({ ...r, kind: 'BOX_IN_OUT', orderBox, orderBunch, shipOut });
  }

  // OutQuantity=shipBunch but BoxQuantity=shipOut (환산 뒤바뀜)
  if (Math.abs(Number(r.shipBox) - shipOut) < 0.01 && Math.abs(shipBunch - shipOut / b1b) < 0.01 && b1b > 1) {
    mismatches.push({ ...r, kind: 'SWAPPED_BOX_BUNCH', shipOut, shipBox: r.shipBox, shipBunch });
  }
}

console.log(`총 ${rows.recordset.length}건, 불일치/의심 ${mismatches.length}건\n`);
for (const m of mismatches) {
  console.log(`[${m.kind}] ${m.CustName} | ${m.ProdName.slice(0, 40)}`);
  console.log(`  B1B=${m.B1B} orderBox=${m.orderBox} orderBunch=${m.orderBunch} shipOut=${m.shipOut} shipBox=${m.shipBox} shipBunch=${m.shipBunch}`);
  if (m.diff != null) console.log(`  diff ship-order bunch: ${m.diff}`);
  if (m.shipDescr) console.log(`  Descr: ${m.shipDescr.slice(0, 100)}`);
  console.log('');
}

// ShipmentHistory 웹/출고분배 이력
const hist = await query(
  `SELECT TOP 50 c.CustName, p.ProdName, sh.ChangeType, sh.BeforeValue, sh.AfterValue,
          sh.Descr, sh.ChangeDtm
   FROM ShipmentHistory sh
   JOIN ShipmentDetail sd ON sd.ShipmentKey=sh.ShipmentKey AND sd.ProdKey=sh.ProdKey
   JOIN ShipmentMaster sm ON sm.ShipmentKey=sh.ShipmentKey
   JOIN Customer c ON c.CustKey=sm.CustKey
   JOIN Product p ON p.ProdKey=sh.ProdKey
   WHERE sm.OrderWeek=@wk AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미'
     AND (sh.Descr LIKE N'%웹%' OR sh.Descr LIKE N'%paste%' OR sh.Descr LIKE N'%분배%' OR sh.Descr LIKE N'%adjust%')
   ORDER BY sh.ChangeDtm DESC`,
  { wk: { type: sql.NVarChar, value: week } },
);

console.log(`\n=== 웹 분배 이력 (최근 ${hist.recordset.length}건) ===\n`);
hist.recordset.slice(0, 15).forEach(h => {
  console.log(`${h.ChangeDtm.toISOString?.().slice(0, 16) || h.ChangeDtm} ${h.CustName} | ${h.ProdName.slice(0, 30)} | ${h.BeforeValue}→${h.AfterValue} | ${(h.Descr || '').slice(0, 60)}`);
});
