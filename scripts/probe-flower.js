const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  console.log('## Flower 테이블 컬럼:');
  const cols = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Flower' ORDER BY ORDINAL_POSITION`);
  cols.recordset.forEach(r => console.log(`  ${r.COLUMN_NAME} (${r.DATA_TYPE})`));

  console.log('\n## Flower 전체 (BoxWeight 우선)');
  const all = await pool.request().query(`SELECT * FROM Flower ORDER BY FlowerName`);
  all.recordset.forEach(r => console.log(`  ${JSON.stringify(r)}`));
  console.log(`총 ${all.recordset.length}건`);

  console.log('\n## 엑셀 카테고리명 (ROSE/Sinensis/Gypsophila/LISIANTHUS/others/CARNATION/EUCALYPTUS) 매칭:');
  const targets = ['ROSE','Sinensis','Gypsophila','LISIANTHUS','others','CARNATION','EUCALYPTUS','장미','안개꽃','카네이션'];
  for (const t of targets) {
    const r = await pool.request().query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE FlowerName=N'${t}' AND isDeleted=0`);
    if (r.recordset.length) console.log(`  ✅ ${t.padEnd(12)} BoxW=${r.recordset[0].BoxWeight} CBM=${r.recordset[0].BoxCBM} SPB=${r.recordset[0].StemsPerBox} Tariff=${r.recordset[0].DefaultTariff}`);
    else console.log(`  ❌ ${t.padEnd(12)} 없음`);
  }

  await pool.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
