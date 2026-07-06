import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

const week = process.argv[2] || '25-02';
const orderYear = process.argv[3] || '2026';
const yw = `${orderYear}${week.replace('-', '')}`;

const orderProds = await query(
  `SELECT COUNT(DISTINCT p.ProdKey) AS cnt,
          COUNT(DISTINCT p.FlowerName) AS flowers
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   JOIN Product p ON p.ProdKey = od.ProdKey AND p.isDeleted = 0
   WHERE om.isDeleted = 0
     AND om.OrderYear + REPLACE(om.OrderWeek, '-', '') = @yw
     AND p.CounName = N'네덜란드'
     AND od.OutQuantity > 0`,
  { yw: { type: sql.NVarChar, value: yw } },
);

const byFlower = await query(
  `SELECT p.FlowerName, COUNT(DISTINCT p.ProdKey) AS prodCnt, SUM(od.OutQuantity) AS qty
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   JOIN Product p ON p.ProdKey = od.ProdKey AND p.isDeleted = 0
   WHERE om.isDeleted = 0
     AND om.OrderYear + REPLACE(om.OrderWeek, '-', '') = @yw
     AND p.CounName = N'네덜란드'
     AND od.OutQuantity > 0
   GROUP BY p.FlowerName
   ORDER BY p.FlowerName`,
  { yw: { type: sql.NVarChar, value: yw } },
);

console.log(`=== DB ${orderYear} ${week} Netherlands orders ===`);
console.log('Distinct products:', orderProds.recordset[0].cnt);
console.log('Distinct flowers:', orderProds.recordset[0].flowers);
console.log('\nBy flower:');
byFlower.recordset.forEach(r => console.log(`  ${r.FlowerName}: ${r.prodCnt} products, qty=${r.qty}`));

// Also check incoming-only products
const incoming = await query(
  `SELECT COUNT(DISTINCT p.ProdKey) AS cnt
   FROM WarehouseDetail wd
   JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
   JOIN Product p ON wd.ProdKey = p.ProdKey AND p.isDeleted = 0
   WHERE wm.OrderYear + REPLACE(wm.OrderWeek, '-', '') = @yw
     AND p.CounName = N'네덜란드'`,
  { yw: { type: sql.NVarChar, value: yw } },
);
console.log('\nIncoming NL products:', incoming.recordset[0].cnt);
