import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');
const { extractDays, pickDataDay } = await import('../lib/pivotVolumeCustDays.js');

const wk = process.argv[2] || '26-01';
const r = await query(
  `SELECT DISTINCT c.CustKey, c.CustName, c.OrderCode, ISNULL(c.Descr,'') AS custDescr, c.CustArea AS area
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   JOIN Product p ON p.ProdKey = od.ProdKey AND p.isDeleted = 0
   JOIN Customer c ON c.CustKey = om.CustKey
   WHERE om.isDeleted = 0 AND om.OrderWeek = @wk
     AND p.CounName LIKE N'%중국%'
     AND od.OutQuantity > 0
   ORDER BY c.CustArea, c.CustName`,
  { wk: { type: sql.NVarChar, value: wk } },
);

console.log(`=== ${wk} 중국 주문 거래처 Descr (${r.recordset.length}건) ===\n`);
let miss = 0;
for (const c of r.recordset) {
  const days = extractDays(c, '중국');
  const day = pickDataDay(days);
  if (!day) miss += 1;
  console.log(`[${c.area}] ${c.CustName}`);
  console.log(`  Descr: ${JSON.stringify(c.custDescr)}`);
  console.log(`  parse: days=${JSON.stringify(days)} → col.day=${JSON.stringify(day)}`);
  console.log('');
}
console.log(`출고요일 미파싱: ${miss}/${r.recordset.length}`);
