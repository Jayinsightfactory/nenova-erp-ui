import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query } = await import('../lib/db.js');

const names = [
  'Skimmia / Conf Kew Ger Green',
  'Agapanthus / Eyfori',
  'Anthurium Graciosa',
  'Eryngium Magnetar',
  'Eryngium Orion',
  'Eryngium Sirius',
];

for (const n of names) {
  const r = await query(
    `SELECT TOP 3 p.ProdKey, p.FlowerName, p.ProdName
     FROM Product p WHERE p.isDeleted=0 AND p.CounName=N'네덜란드' AND p.ProdName LIKE @n`,
    { n: { type: require('mssql').NVarChar, value: `%${n.split('/')[0].trim()}%` } },
  );
  console.log(n, '->', r.recordset.map(x => x.ProdName).join(' | ') || '(none)');
}
