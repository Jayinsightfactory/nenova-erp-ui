const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

(async () => {
  const p = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  // 수국 25-01 DB
  const r = await p.request().query(`
    SELECT wm.FarmName, p.ProdName, p.FlowerName, wd.UPrice, wd.OutQuantity
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    JOIN Product p ON wd.ProdKey=p.ProdKey AND p.isDeleted=0
    WHERE wm.isDeleted=0 AND wm.OrderYear='2026' AND wm.OrderWeek='25-01'
      AND p.FlowerName = N'수국' AND wd.OutQuantity > 0
    ORDER BY wm.FarmName, p.ProdName`);

  console.log('DB 25-01 수국:', r.recordset.length, '건\n');
  r.recordset.forEach(x => console.log(`  ${x.FarmName?.trim()} | ${x.ProdName} | FOB=${x.UPrice}`));

  // 루스커스 25-01
  const r2 = await p.request().query(`
    SELECT wm.FarmName, p.ProdName, wd.UPrice
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    JOIN Product p ON wd.ProdKey=p.ProdKey
    WHERE wm.isDeleted=0 AND wm.OrderYear='2026' AND wm.OrderWeek='25-01'
      AND p.FlowerName = N'루스커스' AND wd.OutQuantity > 0
    ORDER BY p.ProdName`);
  console.log('\nDB 25-01 루스커스:', r2.recordset.length);
  r2.recordset.forEach(x => console.log(`  ${x.FarmName?.trim()} | ${x.ProdName} | FOB=${x.UPrice}`));

  // Farms in 25-01 Excel colombia but check missing farms
  const farms = await p.request().query(`
    SELECT DISTINCT FarmName FROM WarehouseMaster
    WHERE isDeleted=0 AND OrderYear='2026' AND OrderWeek='25-01'
    ORDER BY FarmName`);
  console.log('\nDB 25-01 farms:', farms.recordset.length);

  // Previous week 24-02 flowers not in 25-01
  const gap = await p.request().query(`
    SELECT p.FlowerName, COUNT(DISTINCT p.ProdKey) cnt
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    JOIN Product p ON wd.ProdKey=p.ProdKey AND p.isDeleted=0
    WHERE wm.isDeleted=0 AND wm.OrderYear='2026' AND wm.OrderWeek='24-02'
      AND wd.OutQuantity > 0
      AND p.ProdKey NOT IN (
        SELECT wd2.ProdKey FROM WarehouseDetail wd2
        JOIN WarehouseMaster wm2 ON wd2.WarehouseKey=wm2.WarehouseKey
        WHERE wm2.isDeleted=0 AND wm2.OrderYear='2026' AND wm2.OrderWeek='25-01'
          AND wd2.OutQuantity > 0
      )
    GROUP BY p.FlowerName ORDER BY cnt DESC`);
  console.log('\n🔴 24-02 있었으나 25-01 입고 없는 품종(ProdKey 기준):');
  gap.recordset.forEach(x => console.log(`  ${x.FlowerName}: ${x.cnt}품목`));

  await p.close();
})().catch(console.error);
