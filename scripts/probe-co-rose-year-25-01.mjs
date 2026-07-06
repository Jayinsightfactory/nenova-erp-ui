import fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');

for (const year of ['2025', '2026']) {
  const r = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
     JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderWeek=N'25-01' AND sm.isDeleted=0 AND sd.OutQuantity>0
       AND p.CounName=N'콜롬비아' AND p.FlowerName=N'장미'
       AND sm.OrderYear=@y`,
    { y: { type: sql.NVarChar, value: year } },
  );
  console.log(`OrderYear ${year}: ${r.recordset[0].cnt} shipment rows`);
}
