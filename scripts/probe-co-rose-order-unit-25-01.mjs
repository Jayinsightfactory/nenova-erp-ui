import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const week = '25-01';
const r = await query(
  `SELECT c.CustName, p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS B1B,
          od.OutQuantity, od.BoxQuantity, od.BunchQuantity, ISNULL(od.Descr,'') AS descr
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
   JOIN Customer c ON c.CustKey=om.CustKey
   JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
   WHERE om.isDeleted=0 AND om.OrderWeek=@wk AND od.OutQuantity>0
     AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미' AND p.OutUnit=N'단'
   ORDER BY c.CustName, p.ProdName`,
  { wk: { type: sql.NVarChar, value: week } },
);

console.log(`=== ${week} CO rose 주문(OrderDetail) ${r.recordset.length}건 ===\n`);
let ok = 0; let suspect = 0;
for (const o of r.recordset) {
  const b1b = Number(o.B1B) || 10;
  const out = Number(o.OutQuantity);
  const bunch = Number(o.BunchQuantity);
  const box = Number(o.BoxQuantity);
  // OutUnit=단: OutQuantity should equal BunchQuantity; Box ≈ Out/B1B
  const bunchOk = Math.abs(out - bunch) < 0.01;
  const boxOk = box <= 0 || Math.abs(box - out / b1b) < 0.15;
  if (bunchOk && boxOk) { ok += 1; continue; }
  suspect += 1;
  console.log(`[주문환산] ${o.CustName} | ${o.ProdName.slice(0, 40)}`);
  console.log(`  Out=${out} Box=${box} Bunch=${bunch} B1B=${b1b} | Out≈Bunch? ${bunchOk} Box≈Out/B1B? ${boxOk}`);
  if (o.descr) console.log(`  Descr: ${o.descr.slice(0, 80)}`);
  console.log('');
}
console.log(`정상 ${ok}건, 환산 의심 ${suspect}건`);
