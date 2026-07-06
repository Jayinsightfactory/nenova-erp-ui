import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const groups = await query(`
  SELECT CounName AS country, FlowerName AS flower,
         ISNULL(CounName,'') + ISNULL(FlowerName,'') AS label, COUNT(*) AS prodCount
  FROM Product WHERE isDeleted = 0
  GROUP BY CounName, FlowerName
  ORDER BY CounName, FlowerName`);

const nl = groups.recordset.filter(g => /네덜/i.test(g.country));
console.log('orders/new style groups for Netherlands:', nl.length);
nl.forEach(g => console.log(`  ${g.label} (${g.prodCount})`));

const hardcoded = ['콜롬비아카네이션','콜롬비아장미','콜롬비아수국','콜롬비아알스트로','에콰도르장미','네덜란드','중국기타','국내왁스'];
const cfAll = await query(`
  SELECT CountryFlower, COUNT(*) cnt FROM Product WHERE isDeleted=0 AND CountryFlower<>'' GROUP BY CountryFlower ORDER BY CountryFlower`);
console.log('\nHardcoded vs DB CountryFlower:');
console.log('  Hardcoded count:', hardcoded.length);
console.log('  DB CountryFlower count:', cfAll.recordset.length);
const missing = cfAll.recordset.filter(r => !hardcoded.includes(r.CountryFlower));
console.log('  Missing from hardcoded:', missing.length);
missing.slice(0, 15).forEach(r => console.log(`    ${r.CountryFlower} (${r.cnt})`));
