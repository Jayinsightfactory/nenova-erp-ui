import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const countries = await query(`SELECT CounName, Sort FROM Country WHERE isDeleted=0 ORDER BY Sort`);
console.log('Countries (Sort):');
countries.recordset.forEach(r => console.log(`  ${String(r.Sort).padStart(3)}\t${r.CounName}`));

const flowers = await query(`SELECT FlowerName, Sort, OrderNo FROM Flower WHERE isDeleted=0 ORDER BY Sort, OrderNo`);
console.log('\nFlowers (Sort, OrderNo) — first 30:');
flowers.recordset.slice(0, 30).forEach(r => console.log(`  ${String(r.Sort).padStart(3)}\t${String(r.OrderNo ?? '').padStart(3)}\t${r.FlowerName}`));

const cfGroups = await query(`
  SELECT p.CountryFlower, MIN(c.Sort) AS cSort, MIN(f.Sort) AS fSort, MIN(f.OrderNo) AS fOrderNo, COUNT(*) AS cnt
  FROM Product p
  LEFT JOIN Country c ON p.CounName = c.CounName AND c.isDeleted = 0
  LEFT JOIN Flower f ON p.FlowerName = f.FlowerName AND f.isDeleted = 0
  WHERE p.isDeleted = 0 AND p.CountryFlower IS NOT NULL AND p.CountryFlower <> ''
  GROUP BY p.CountryFlower
  ORDER BY MIN(ISNULL(c.Sort,9999)), MIN(ISNULL(f.Sort,9999)), MIN(ISNULL(f.OrderNo,9999)), p.CountryFlower`);
console.log('\nCountryFlower groups (ERP order) — first 30:');
cfGroups.recordset.slice(0, 30).forEach(r => console.log(`  ${String(r.cSort).padStart(3)}\t${String(r.fSort ?? '').padStart(3)}\t${r.CountryFlower}\t(${r.cnt})`));
console.log('Total CountryFlower groups:', cfGroups.recordset.length);

const prodSample = await query(`
  SELECT TOP 10 p.ProdName, p.CounName, p.FlowerName, p.CountryFlower, c.Sort AS cSort, f.Sort AS fSort
  FROM Product p
  LEFT JOIN Country c ON p.CounName = c.CounName AND c.isDeleted = 0
  LEFT JOIN Flower f ON p.FlowerName = f.FlowerName AND f.isDeleted = 0
  WHERE p.isDeleted = 0 AND p.CountryFlower LIKE N'%카네%'
  ORDER BY ISNULL(c.Sort,9999), ISNULL(f.Sort,9999), ISNULL(f.OrderNo,9999), p.ProdName`);

console.log('\nCarnation products sample order:');
prodSample.recordset.forEach(r => console.log(`  ${r.ProdName} | ${r.CountryFlower}`));
