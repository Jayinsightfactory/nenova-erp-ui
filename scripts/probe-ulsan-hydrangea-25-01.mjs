import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const ck = 489;
const wk = '25-01';

const od = await query(
  `SELECT p.ProdName, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity, od.isDeleted
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
   JOIN Product p ON p.ProdKey = od.ProdKey
   WHERE om.CustKey = @ck AND om.OrderWeek = @wk AND ISNULL(om.isDeleted,0)=0
     AND p.ProdName LIKE N'%Hydrangea%'`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('OrderDetail (including deleted):');
od.recordset.forEach(r => console.log(`  ${r.ProdName} box=${r.BoxQuantity} out=${r.OutQuantity} deleted=${r.isDeleted}`));

const sd = await query(
  `SELECT p.ProdName, sd.OutQuantity, sd.BoxQuantity, sd.Descr
   FROM ShipmentMaster sm
   JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
   JOIN Product p ON p.ProdKey = sd.ProdKey
   WHERE sm.CustKey = @ck AND sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0)=0
     AND p.ProdName LIKE N'%Hydrangea%'`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\nShipmentDetail:');
sd.recordset.forEach(r => {
  console.log(`  ${r.ProdName} out=${r.OutQuantity} box=${r.BoxQuantity}`);
  console.log(`    ${(r.Descr || '').replace(/\r?\n/g, ' | ')}`);
});

const vo = await query(
  `SELECT vo.ProdName, vo.BoxQuantity FROM ViewOrder vo
   WHERE vo.CustKey=@ck AND vo.OrderWeek=@wk AND vo.ProdName LIKE N'%Hydrangea%'`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\nViewOrder (nenova.exe 주문/분배 grid):');
vo.recordset.forEach(r => console.log(`  ${r.ProdName} box=${r.BoxQuantity}`));

const vs = await query(
  `SELECT vs.ProdName, vs.OutQuantity FROM ViewShipment vs
   WHERE vs.CustKey=@ck AND vs.OrderWeek=@wk AND vs.ProdName LIKE N'%Hydrangea%'`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\nViewShipment (nenova.exe 출고분배):');
vs.recordset.forEach(r => console.log(`  ${r.ProdName} out=${r.OutQuantity}`));

const oh = await query(
  `SELECT TOP 15 oh.ChangeDtm, oh.BeforeValue, oh.AfterValue, p.ProdName
   FROM OrderHistory oh
   JOIN OrderDetail od ON od.OrderDetailKey = oh.OrderDetailKey
   JOIN Product p ON p.ProdKey = od.ProdKey
   JOIN OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey
   WHERE om.CustKey=@ck AND om.OrderWeek=@wk AND p.ProdName LIKE N'%Hydrangea%'
   ORDER BY oh.ChangeDtm DESC`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\nOrderHistory:');
oh.recordset.forEach(r => console.log(`  ${r.ChangeDtm} ${r.ProdName} ${r.BeforeValue}->${r.AfterValue}`));

const sh = await query(
  `SELECT TOP 15 sh.ChangeDtm, sh.ChangeType, sh.BeforeValue, sh.AfterValue, p.ProdName
   FROM ShipmentHistory sh
   JOIN ShipmentDetail sd ON sd.SdetailKey = sh.SdetailKey
   JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
   JOIN Product p ON p.ProdKey = sd.ProdKey
   WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND p.ProdName LIKE N'%Hydrangea%'
   ORDER BY sh.ChangeDtm DESC`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\nShipmentHistory:');
sh.recordset.forEach(r => console.log(`  ${r.ChangeDtm} ${r.ProdName} [${r.ChangeType}] ${r.BeforeValue}->${r.AfterValue}`));
