import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const yw = '20262502';
const custLike = process.argv[2] || '%';

const r = await query(
  `SELECT c.CustName, p.FlowerName, p.ProdName, SUM(od.OutQuantity) AS qty
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   JOIN Product p ON p.ProdKey = od.ProdKey AND p.isDeleted = 0
   JOIN Customer c ON c.CustKey = om.CustKey
   WHERE om.isDeleted = 0
     AND om.OrderYear + REPLACE(om.OrderWeek, '-', '') = @yw
     AND p.CounName = N'네덜란드'
     AND od.OutQuantity > 0
     AND c.CustName LIKE @like
   GROUP BY c.CustName, p.FlowerName, p.ProdName
   ORDER BY c.CustName, p.FlowerName, p.ProdName`,
  { yw: { type: sql.NVarChar, value: yw }, like: { type: sql.NVarChar, value: custLike } },
);

const byFlower = new Map();
for (const row of r.recordset) {
  if (!byFlower.has(row.FlowerName)) byFlower.set(row.FlowerName, []);
  byFlower.get(row.FlowerName).push(row);
}

console.log(`Customers matching ${custLike}: ${[...new Set(r.recordset.map(x=>x.CustName))].join(', ')}`);
console.log(`Products: ${r.recordset.length}, flowers: ${byFlower.size}`);
for (const [f, items] of byFlower) {
  console.log(`  ${f} (${items.length})`);
  items.forEach(i => console.log(`    ${i.CustName.slice(0,12)} | ${i.ProdName.slice(0,40)} qty=${i.qty}`));
}
