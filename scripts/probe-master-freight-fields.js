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
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const r = await p.request().query(`
    SELECT FarmName, OrderWeek, OrderNo AS AWB,
      GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD, InvoiceNo
    FROM WarehouseMaster
    WHERE isDeleted=0 AND OrderWeek IN ('24-01','24-02')
      AND FarmName IN ('Cloudland','Holex','La Rosaleda','Royal Base','Krung','Premium Greens','Premium Greens ','Hood Canal','Freightwise Ecuador','NZ Bloom ')
    ORDER BY OrderWeek, FarmName`);

  console.log('Master freight fields for supplier farms:');
  r.recordset.forEach(x => {
    const ok = x.GrossWeight && x.ChargeableWeight && x.FreightRateUSD;
    console.log(`${x.FarmName.trim()} ${x.OrderWeek} AWB:${x.AWB} GW=${x.GrossWeight} CW=${x.ChargeableWeight} Rate=${x.FreightRateUSD} ${ok ? 'OK' : 'MISSING'}`);
  });

  await p.close();
})().catch(console.error);
