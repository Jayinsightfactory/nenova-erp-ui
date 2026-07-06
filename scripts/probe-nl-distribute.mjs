import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

// Recent weeks with NL orders
const weeks = await query(`
  SELECT TOP 5 om.OrderWeek, COUNT(DISTINCT p.ProdKey) AS prodCnt,
         COUNT(DISTINCT p.FlowerName) AS flowerCnt,
         COUNT(DISTINCT p.CountryFlower) AS cfCnt
  FROM OrderMaster om
  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
  JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
  WHERE om.isDeleted=0 AND p.CountryFlower=N'네덜란드'
  GROUP BY om.OrderWeek
  ORDER BY om.OrderWeek DESC`);

console.log('Recent weeks with NL orders:');
weeks.recordset.forEach(r => console.log(`  ${r.OrderWeek}: ${r.prodCnt} products, ${r.flowerCnt} flowers, ${r.cfCnt} CF`));

const wk = weeks.recordset[0]?.OrderWeek;
if (wk) {
  const flowers = await query(`
    SELECT p.FlowerName, COUNT(DISTINCT p.ProdKey) AS prodCnt
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
    JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
    WHERE om.isDeleted=0 AND om.OrderWeek=@wk AND p.CountryFlower=N'네덜란드'
    GROUP BY p.FlowerName
    ORDER BY prodCnt DESC`, { wk: { type: (await import('../lib/db.js')).sql.NVarChar, value: wk } });
  console.log(`\nFlowerName breakdown for week ${wk} (${flowers.recordset.length} flowers):`);
  flowers.recordset.forEach(r => console.log(`  ${r.FlowerName}: ${r.prodCnt}`));
}

// What distribute API returns for prodGroup=네덜란드
if (wk) {
  const prods = await query(`
    SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CountryFlower
    FROM Product p
    WHERE p.isDeleted = 0 AND p.CountryFlower = N'네덜란드'
      AND EXISTS (
        SELECT 1 FROM OrderDetail od3
        JOIN OrderMaster om3 ON od3.OrderMasterKey = om3.OrderMasterKey
        WHERE od3.ProdKey = p.ProdKey AND om3.OrderWeek = @wk
          AND om3.isDeleted = 0 AND od3.isDeleted = 0
      )
    ORDER BY p.FlowerName, p.ProdName`, { wk: { type: (await import('../lib/db.js')).sql.NVarChar, value: wk } });
  console.log(`\nDistribute products API would return ${prods.recordset.length} items for ${wk} + 네덜란드`);
  const byFlower = {};
  prods.recordset.forEach(p => { byFlower[p.FlowerName] = (byFlower[p.FlowerName]||0)+1; });
  console.log('By flower:', Object.keys(byFlower).length, 'types');
}
