import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const custs = await query(`SELECT CustKey, CustName FROM Customer WHERE CustName LIKE N'%울산%' AND isDeleted=0`);
console.log('Ulsan customers:', custs.recordset);

const pasteLog = await query(
  `SELECT TOP 40 LogDtm, Category, Step, Detail
   FROM AppLog
   WHERE Detail LIKE N'%울산%' OR Detail LIKE N'%489%' OR Category LIKE N'%paste%'
   ORDER BY LogDtm DESC`
);
console.log('\nAppLog:');
pasteLog.recordset.forEach(r => console.log(`  ${r.LogDtm} [${r.Category}/${r.Step}] ${(r.Detail || '').slice(0, 160)}`));
