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

  // Ecuador products from excel
  const names = ['Electric MO AS295', 'Channel AS154', 'Dark Navy Blue'];
  for (const n of names) {
    const r = await p.request().input('n', sql.NVarChar, `%${n}%`).query(
      `SELECT TOP 5 wm.FarmName, wm.OrderWeek, p.ProdName, wd.UPrice
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
       WHERE wm.isDeleted=0 AND p.ProdName LIKE @n
       ORDER BY wm.OrderYear DESC, REPLACE(wm.OrderWeek,'-','') DESC`,
    );
    console.log('\nProduct', n, ':', r.recordset.length);
    r.recordset.forEach(x => console.log(`  ${x.FarmName} ${x.OrderWeek} | ${x.ProdName} FOB=${x.UPrice}`));
  }

  // Thailand dendrobium
  const r2 = await p.request().input('n', sql.NVarChar, '%Den.%').query(
    `SELECT TOP 10 wm.FarmName, wm.OrderWeek, p.ProdName, wd.UPrice
     FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
     LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
     WHERE wm.isDeleted=0 AND p.ProdName LIKE @n
     ORDER BY wm.OrderYear DESC`,
  );
  console.log('\nThailand Den products:', r2.recordset.length);
  r2.recordset.forEach(x => console.log(`  ${x.FarmName} ${x.OrderWeek} | ${x.ProdName}`));

  // FreightCost snapshot for week 24-01 Cloudland
  const r3 = await p.request().query(
    `SELECT TOP 5 fc.FreightKey, wm.FarmName, wm.OrderWeek, fcd.ProdName, fcd.ArrivalPerStem, fcd.ArrivalPerBunch
     FROM FreightCost fc
     JOIN WarehouseMaster wm ON fc.WarehouseKey=wm.WarehouseKey
     JOIN FreightCostDetail fcd ON fc.FreightKey=fcd.FreightKey
     WHERE wm.FarmName='Cloudland' AND wm.OrderWeek='24-01'
     ORDER BY fcd.ProdName`,
  );
  console.log('\nFreightCost snapshot Cloudland 24-01:', r3.recordset.length);
  r3.recordset.slice(0, 5).forEach(x => console.log(`  ${x.ProdName} stem=${x.ArrivalPerStem} bunch=${x.ArrivalPerBunch}`));

  await p.close();
})().catch(console.error);
