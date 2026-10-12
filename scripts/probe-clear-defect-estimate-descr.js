#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const envCandidates = [
  path.join(__dirname, '..', '.env.local'),
  path.join('C:', 'Users', 'USER', 'nenova-erp-ui', '.env.local'),
];
const envPath = envCandidates.find((p) => fs.existsSync(p));
if (!envPath) throw new Error('.env.local not found');
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const APPLY = process.argv.includes('--apply');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const list = await pool.request().query(`
    SELECT e.EstimateKey, sm.OrderYear, sm.OrderWeek, c.CustName,
           LEFT(ISNULL(e.Descr,N''), 120) AS Descr,
           LEFT(ISNULL(wd.Note,N''), 120) AS Note
      FROM Estimate e
      JOIN WebSalesDefectDeduction wd
        ON wd.EstimateKey = e.EstimateKey AND ISNULL(wd.IsDeleted,0)=0
      JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
     WHERE ISNULL(e.Descr,N'') <> N''
       AND LTRIM(RTRIM(e.Descr)) = LTRIM(RTRIM(wd.Note))
     ORDER BY sm.OrderYear DESC, sm.OrderWeek DESC, e.EstimateKey DESC`);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | matched=${list.recordset.length}`);
  for (const row of list.recordset.slice(0, 30)) {
    console.log(JSON.stringify(row));
  }
  if (list.recordset.length > 30) console.log(`... +${list.recordset.length - 30} more`);

  if (!APPLY) {
    console.log('\nRe-run with --apply to clear Estimate.Descr where it equals web Note.');
    await pool.close();
    return;
  }

  const upd = await pool.request().query(`
    UPDATE e
       SET e.Descr = N''
      FROM Estimate e
      JOIN WebSalesDefectDeduction wd
        ON wd.EstimateKey = e.EstimateKey AND ISNULL(wd.IsDeleted,0)=0
     WHERE ISNULL(e.Descr,N'') <> N''
       AND LTRIM(RTRIM(e.Descr)) = LTRIM(RTRIM(wd.Note));
    SELECT @@ROWCOUNT AS updated;`);
  console.log(`updated=${upd.recordset[0].updated}`);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
