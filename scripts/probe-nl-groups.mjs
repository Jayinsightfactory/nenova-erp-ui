import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const all = await query(`
  SELECT p.CountryFlower, MIN(c.Sort) AS cSort, MIN(f.Sort) AS fSort, MIN(f.OrderNo) AS fOrderNo, COUNT(*) AS cnt
  FROM Product p
  LEFT JOIN Country c ON p.CounName = c.CounName AND c.isDeleted = 0
  LEFT JOIN Flower f ON p.FlowerName = f.FlowerName AND f.isDeleted = 0
  WHERE p.isDeleted = 0 AND p.CountryFlower IS NOT NULL AND p.CountryFlower <> ''
  GROUP BY p.CountryFlower
  ORDER BY MIN(ISNULL(c.Sort,9999)), MIN(ISNULL(f.Sort,9999)), MIN(ISNULL(f.OrderNo,9999)), p.CountryFlower`);

console.log('Total CountryFlower groups:', all.recordset.length);
console.log('\nAll groups:');
all.recordset.forEach(r => console.log(`  ${r.CountryFlower} (${r.cnt})`));

const nl = all.recordset.filter(r => /네덜|nether/i.test(r.CountryFlower));
console.log('\nNetherlands-related:', nl.length);
nl.forEach(r => console.log(`  ${r.CountryFlower} (${r.cnt})`));

const exact = await query(`SELECT COUNT(*) AS cnt FROM Product WHERE isDeleted=0 AND CountryFlower=N'네덜란드'`);
console.log('\nExact match CountryFlower=네덜란드:', exact.recordset[0].cnt);
