import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const nlFlowers = await query(`
  SELECT p.FlowerName, p.CounName, p.CountryFlower, COUNT(*) AS cnt
  FROM Product p
  WHERE p.isDeleted = 0 AND (p.CounName LIKE N'%네덜%' OR p.CountryFlower LIKE N'%네덜%')
  GROUP BY p.FlowerName, p.CounName, p.CountryFlower
  ORDER BY cnt DESC, p.FlowerName`);

console.log('Netherlands products by FlowerName:');
nlFlowers.recordset.forEach(r => console.log(`  ${r.CounName} | ${r.FlowerName} | CF=${r.CountryFlower} (${r.cnt})`));
console.log('Distinct FlowerName count:', nlFlowers.recordset.length);

// Check if nenova uses ProdGroup field
const prodGroup = await query(`
  SELECT TOP 20 p.ProdGroup, COUNT(*) AS cnt
  FROM Product p
  WHERE p.isDeleted = 0 AND p.CounName LIKE N'%네덜%'
  GROUP BY p.ProdGroup
  ORDER BY cnt DESC`);
console.log('\nProdGroup values for Netherlands:');
prodGroup.recordset.forEach(r => console.log(`  ${r.ProdGroup || '(null)'} (${r.cnt})`));

// Compare hardcoded PROD_GROUPS vs actual for a recent week
const week = await query(`
  SELECT DISTINCT p.CountryFlower, COUNT(DISTINCT p.ProdKey) AS prodCnt
  FROM OrderMaster om
  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
  JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
  WHERE om.isDeleted=0 AND om.OrderWeek LIKE N'%-%'
  GROUP BY p.CountryFlower
  ORDER BY p.CountryFlower`);
console.log('\nCountryFlower in orders (all weeks):');
week.recordset.forEach(r => console.log(`  ${r.CountryFlower} (${r.prodCnt} products)`));
