const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const AWBS = ['99993212291', '00645432564', '18050704872', '73805998926', '21709575005'];

(async () => {
  const p = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  for (const awb of AWBS) {
    console.log('\n=== AWB', awb, '===');
    const m = await p.request().input('a', sql.NVarChar, awb).query(`
      SELECT WarehouseKey, FarmName, OrderWeek, GrossWeight, ChargeableWeight, FreightRateUSD, OrderNo
      FROM WarehouseMaster WHERE isDeleted=0 AND REPLACE(REPLACE(OrderNo,'-',''),' ','')=@a
      ORDER BY WarehouseKey`);
    m.recordset.forEach(x => console.log(`  WK${x.WarehouseKey} ${x.FarmName} GW=${x.GrossWeight} CW=${x.ChargeableWeight} Rate=${x.FreightRateUSD}`));

    const wks = m.recordset.map(x => x.WarehouseKey).join(',');
    if (!wks) continue;
    const d = await p.request().query(`
      SELECT wd.WarehouseKey, wm.FarmName, p.ProdName, wd.UPrice, wd.BunchQuantity, wd.OutQuantity, wd.TPrice
      FROM WarehouseDetail wd
      JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
      LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wd.WarehouseKey IN (${wks})
      ORDER BY wd.WdetailKey`);
    d.recordset.slice(0, 15).forEach(x => console.log(`    ${x.FarmName} | ${x.ProdName||'(special)'} UPrice=${x.UPrice} BunchQty=${x.BunchQuantity} OutQty=${x.OutQuantity}`));
    if (d.recordset.length > 15) console.log(`    ... +${d.recordset.length - 15} more`);
  }
  await p.close();
})().catch(console.error);
