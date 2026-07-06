import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const custs = await query(
  `SELECT CustKey, CustName, CustArea, Manager FROM Customer
   WHERE CustName LIKE N'%신라%' OR CustName LIKE N'%아이엠%'
   ORDER BY CustName`
);
console.log('=== 거래처 매칭 ===');
custs.recordset.forEach((c) => console.log(c.CustKey, c.CustName, c.CustArea || '', c.Manager || ''));

const dates = ['2025-04-30', '2026-04-30'];
for (const d of dates) {
  console.log(`\n========== 날짜 ${d} ==========`);
  const oh = await query(
    `SELECT TOP 300 CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS dt, oh.ChangeID, c.CustName, om.OrderWeek, p.ProdName,
            oh.ChangeType, oh.ColumName, oh.BeforeValue, oh.AfterValue, LEFT(oh.Descr, 100) AS Descr
     FROM OrderHistory oh
     JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
     JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
     LEFT JOIN Customer c ON om.CustKey = c.CustKey
     LEFT JOIN Product p ON od.ProdKey = p.ProdKey
     WHERE CAST(oh.ChangeDtm AS DATE) = @d
       AND (c.CustName LIKE N'%신라%' OR c.CustName LIKE N'%아이엠%')
     ORDER BY oh.ChangeDtm, c.CustName`,
    { d: { type: sql.NVarChar, value: d } }
  );
  console.log(`OrderHistory: ${oh.recordset.length}건`);
  const byUserOh = {};
  oh.recordset.forEach((r) => {
    byUserOh[r.ChangeID] = (byUserOh[r.ChangeID] || 0) + 1;
    console.log(`  ${r.dt} | ${r.ChangeID} | ${r.CustName} | ${r.OrderWeek} | ${r.ProdName} | ${r.ChangeType} ${r.BeforeValue}>${r.AfterValue}`);
  });
  console.log('  [OrderHistory 담당자별]', byUserOh);

  const sh = await query(
    `SELECT TOP 300 CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS dt, sh.ChangeID, c.CustName, sm.OrderWeek, p.ProdName,
            sh.ChangeType, sh.BeforeValue, sh.AfterValue, LEFT(sh.Descr, 100) AS Descr
     FROM ShipmentHistory sh
     JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     LEFT JOIN Customer c ON sm.CustKey = c.CustKey
     LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
     WHERE CAST(sh.ChangeDtm AS DATE) = @d
       AND (c.CustName LIKE N'%신라%' OR c.CustName LIKE N'%아이엠%')
     ORDER BY sh.ChangeDtm, c.CustName`,
    { d: { type: sql.NVarChar, value: d } }
  );
  console.log(`ShipmentHistory: ${sh.recordset.length}건`);
  const byUserSh = {};
  sh.recordset.forEach((r) => {
    byUserSh[r.ChangeID] = (byUserSh[r.ChangeID] || 0) + 1;
    console.log(`  ${r.dt} | ${r.ChangeID} | ${r.CustName} | ${r.OrderWeek} | ${r.ProdName} | ${r.ChangeType} ${r.BeforeValue}>${r.AfterValue}`);
  });
  console.log('  [ShipmentHistory 담당자별]', byUserSh);

  try {
    const adj = await query(
      `SELECT TOP 100 CONVERT(NVARCHAR(19), sa.CreateDtm, 120) AS dt, sa.CreateID, c.CustName, sa.OrderWeek, p.ProdName,
              sa.AdjustType, sa.Qty, LEFT(sa.Memo, 100) AS Memo
       FROM ShipmentAdjustment sa
       LEFT JOIN Customer c ON sa.CustKey = c.CustKey
       LEFT JOIN Product p ON sa.ProdKey = p.ProdKey
       WHERE CAST(sa.CreateDtm AS DATE) = @d
         AND (c.CustName LIKE N'%신라%' OR c.CustName LIKE N'%아이엠%')
       ORDER BY sa.CreateDtm`,
      { d: { type: sql.NVarChar, value: d } }
    );
    console.log(`ShipmentAdjustment: ${adj.recordset.length}건`);
    adj.recordset.forEach((r) => console.log(`  ${r.dt} | ${r.CreateID} | ${r.CustName} | ${r.OrderWeek} | ${r.AdjustType} ${r.Qty} | ${r.ProdName}`));
  } catch (e) {
    console.log('ShipmentAdjustment skip:', e.message);
  }
}

// 사용자 계정 매핑 (있으면)
for (const tbl of ['Employee', 'Users', 'UserMaster', 'LoginUser']) {
  try {
    const users = await query(`SELECT TOP 30 * FROM [${tbl}] WHERE 1=0`);
    console.log(`\n=== ${tbl} exists, columns:`, Object.keys(users.recordset.columns || users.recordset[0] || {}));
  } catch { /* skip */ }
}
try {
  const users = await query(
    `SELECT TOP 50 UserID, UserName FROM Employee WHERE UserID LIKE N'nenova%' ORDER BY UserID`
  );
  if (users.recordset.length) {
    console.log('\n=== Employee 계정 ===');
    users.recordset.forEach((u) => console.log(`  ${u.UserID} | ${u.UserName || ''}`));
  }
} catch (e) {
  console.log('Employee skip:', e.message);
}

process.exit(0);
