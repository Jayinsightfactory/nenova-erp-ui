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
    SELECT wm.FarmName, wm.OrderWeek,
      CASE WHEN fc.FreightKey IS NOT NULL THEN 1 ELSE 0 END AS hasFreightCost,
      COUNT(DISTINCT wd.ProdKey) AS prodCount
    FROM WarehouseMaster wm
    LEFT JOIN FreightCost fc ON fc.WarehouseKey=wm.WarehouseKey AND fc.isDeleted=0
    LEFT JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product pr ON wd.ProdKey=pr.ProdKey AND pr.isDeleted=0
    WHERE wm.isDeleted=0
      AND wm.FarmName IN ('Cloudland','Holex','Premium Greens','Premium Greens ','Hood Canal','La Rosaleda','Royal Base','NZ Bloom ','Krung','Freightwise Ecuador')
      AND wm.OrderWeek IN ('24-01','24-02','17-01','13-01')
    GROUP BY wm.FarmName, wm.OrderWeek, CASE WHEN fc.FreightKey IS NOT NULL THEN 1 ELSE 0 END
    ORDER BY wm.OrderWeek, wm.FarmName`);

  console.log('Farm | Week | FreightCost saved | Products');
  r.recordset.forEach(x => console.log(`${x.FarmName.trim()} | ${x.OrderWeek} | ${x.hasFreightCost ? 'YES' : 'NO'} | ${x.prodCount}`));

  await p.close();
})().catch(console.error);
