import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const week = '25-01';

const custs = await query(
  `SELECT CustKey, CustName, OrderCode
   FROM Customer
   WHERE (CustName LIKE N'%동산%' OR CustName LIKE N'%울산%')
     AND ISNULL(isDeleted,0)=0
   ORDER BY CustName`
);
console.log('Matching customers:');
custs.recordset.forEach(c => console.log(`  [${c.CustKey}] ${c.CustName} (${c.OrderCode})`));

for (const c of custs.recordset) {
  const ck = c.CustKey;
  const od = await query(
    `SELECT p.ProdName, p.FlowerName, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity, od.isDeleted
     FROM OrderMaster om
     JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
     JOIN Product p ON p.ProdKey = od.ProdKey
     WHERE om.CustKey=@ck AND om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
       AND (p.FlowerName LIKE N'%수국%' OR p.ProdName LIKE N'%Hydrangea%' OR p.ProdName LIKE N'%수국%')
     ORDER BY p.ProdName`,
    { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
  );
  if (!od.recordset.length) continue;

  console.log(`\n=== ${c.CustName} (ck=${ck}) OrderDetail 25-01 수국 ===`);
  od.recordset.forEach(r => console.log(`  ${r.ProdName} box=${r.BoxQuantity} out=${r.OutQuantity} del=${r.isDeleted}`));

  const sd = await query(
    `SELECT p.ProdName, sd.OutQuantity, sd.BoxQuantity, sd.Descr
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     JOIN Product p ON p.ProdKey = sd.ProdKey
     WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
       AND (p.FlowerName LIKE N'%수국%' OR p.ProdName LIKE N'%Hydrangea%')
     ORDER BY p.ProdName`,
    { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
  );
  console.log('  ShipmentDetail:');
  if (!sd.recordset.length) console.log('    (none)');
  sd.recordset.forEach(r => {
    console.log(`    ${r.ProdName} out=${r.OutQuantity} box=${r.BoxQuantity}`);
    if (r.Descr) console.log(`      ${r.Descr.replace(/\r?\n/g, ' | ').slice(0, 200)}`);
  });

  const oh = await query(
    `SELECT TOP 8 oh.ChangeDtm, oh.BeforeValue, oh.AfterValue, p.ProdName
     FROM OrderHistory oh
     JOIN OrderDetail od ON od.OrderDetailKey = oh.OrderDetailKey
     JOIN Product p ON p.ProdKey = od.ProdKey
     JOIN OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey
     WHERE om.CustKey=@ck AND om.OrderWeek=@wk
       AND (p.FlowerName LIKE N'%수국%' OR p.ProdName LIKE N'%Hydrangea%')
     ORDER BY oh.ChangeDtm DESC`,
    { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
  );
  console.log('  OrderHistory:');
  oh.recordset.forEach(r => console.log(`    ${r.ChangeDtm} ${r.ProdName} ${r.BeforeValue}->${r.AfterValue}`));
}

// AppLog: 동산 paste
const logs = await query(
  `SELECT TOP 20 LogDtm, Category, Step, Detail
   FROM AppLog
   WHERE Detail LIKE N'%동산%' AND (Detail LIKE N'%25%' OR Detail LIKE N'%취소%' OR Detail LIKE N'%수국%')
   ORDER BY LogDtm DESC`
);
console.log('\nAppLog (동산 + 25/취소/수국):');
logs.recordset.forEach(r => console.log(`  ${r.LogDtm} [${r.Step}] ${(r.Detail||'').slice(0,180)}`));
