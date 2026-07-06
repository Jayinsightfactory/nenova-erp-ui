import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const ck = 315;
const wk = '25-01';

const allOd = await query(
  `SELECT od.OrderDetailKey, od.ProdKey, p.ProdName, od.BoxQuantity, od.OutQuantity,
          od.isDeleted, od.CreateDtm, od.LastUpdateDtm
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
   JOIN Product p ON p.ProdKey = od.ProdKey
   WHERE om.CustKey=@ck AND om.OrderWeek=@wk
     AND p.ProdName LIKE N'%Hydrangea%'
   ORDER BY p.ProdName, od.isDeleted, od.OrderDetailKey`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('=== 동산 All OrderDetail rows (incl deleted) ===');
allOd.recordset.forEach(r => console.log(`  key=${r.OrderDetailKey} pk=${r.ProdKey} ${r.ProdName} box=${r.BoxQuantity} del=${r.isDeleted} created=${r.CreateDtm} upd=${r.LastUpdateDtm}`));

const oh = await query(
  `SELECT oh.ChangeDtm, oh.BeforeValue, oh.AfterValue, oh.Descr, p.ProdName, od.OrderDetailKey
   FROM OrderHistory oh
   JOIN OrderDetail od ON od.OrderDetailKey = oh.OrderDetailKey
   JOIN Product p ON p.ProdKey = od.ProdKey
   JOIN OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey
   WHERE om.CustKey=@ck AND om.OrderWeek=@wk AND p.ProdName LIKE N'%Hydrangea%'
   ORDER BY oh.ChangeDtm`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\n=== OrderHistory full ===');
oh.recordset.forEach(r => console.log(`  ${r.ChangeDtm} key=${r.OrderDetailKey} ${r.ProdName} ${r.BeforeValue}->${r.AfterValue} | ${(r.Descr||'').slice(0,80)}`));

const sh = await query(
  `SELECT sh.ChangeDtm, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr, p.ProdName
   FROM ShipmentHistory sh
   JOIN ShipmentDetail sd ON sd.SdetailKey = sh.SdetailKey
   JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
   JOIN Product p ON p.ProdKey = sd.ProdKey
   WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND p.ProdName LIKE N'%Hydrangea%'
   ORDER BY sh.ChangeDtm`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\n=== ShipmentHistory ===');
sh.recordset.forEach(r => console.log(`  ${r.ChangeDtm} ${r.ProdName} [${r.ChangeType}] ${r.BeforeValue}->${r.AfterValue}`));

const vo = await query(
  `SELECT vo.ProdName, vo.BoxQuantity FROM ViewOrder vo WHERE vo.CustKey=@ck AND vo.OrderWeek=@wk AND vo.ProdName LIKE N'%Hydrangea%' ORDER BY vo.ProdName`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\n=== ViewOrder (exe) ===');
vo.recordset.forEach(r => console.log(`  ${r.ProdName} box=${r.BoxQuantity}`));

const vs = await query(
  `SELECT vs.ProdName, vs.OutQuantity FROM ViewShipment vs WHERE vs.CustKey=@ck AND vs.OrderWeek=@wk AND vs.ProdName LIKE N'%Hydrangea%' ORDER BY vs.ProdName`,
  { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: wk } }
);
console.log('\n=== ViewShipment (exe distribute) ===');
vs.recordset.forEach(r => console.log(`  ${r.ProdName} out=${r.OutQuantity}`));

// createOrder logs for ck=315 week 25-01
const logs = await query(
  `SELECT LogDtm, Category, Step, Detail FROM AppLog
   WHERE (Detail LIKE N'%ck=315%' OR Detail LIKE N'%custKey=315%' OR Detail LIKE N'%동산%')
     AND Detail LIKE N'%25%'
   ORDER BY LogDtm DESC`
);
console.log('\n=== AppLog ===');
logs.recordset.forEach(r => console.log(`  ${r.LogDtm} [${r.Category}/${r.Step}] ${(r.Detail||'').slice(0,200)}`));
