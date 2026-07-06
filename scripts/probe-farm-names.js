const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

(async () => {
  const p = await sql.connect({
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const terms = ['Hood', 'Canal', 'NZBLOOM', 'PREMIUM', 'SUNPRIDE', 'Holex', 'Melody', 'Cloudland', '덴파레', 'Apollo', 'Ecuador', 'NL', 'NEWZELAND'];
  for (const t of terms) {
    const r = await p.request().input('t', sql.NVarChar, `%${t}%`).query(
      `SELECT TOP 5 FarmName, OrderYear, OrderWeek, COUNT(*) AS cnt
       FROM WarehouseMaster WHERE isDeleted=0 AND FarmName LIKE @t
       GROUP BY FarmName, OrderYear, OrderWeek
       ORDER BY OrderYear DESC, REPLACE(OrderWeek,'-','') DESC`,
    );
    console.log('---', t, '---');
    if (r.recordset.length) r.recordset.forEach(x => console.log(JSON.stringify(x)));
    else console.log('NONE');
  }
  const wk = await p.request().query(
    `SELECT TOP 30 FarmName, OrderYear, OrderWeek
     FROM WarehouseMaster WHERE isDeleted=0 AND OrderWeek LIKE '24-%'
     ORDER BY OrderYear DESC, REPLACE(OrderWeek,'-','') DESC`,
  );
  console.log('\nRecent 24-xx:');
  wk.recordset.forEach(x => console.log(`${x.OrderYear} ${x.OrderWeek} | ${x.FarmName}`));
  await p.close();
})().catch(e => console.error(e));
