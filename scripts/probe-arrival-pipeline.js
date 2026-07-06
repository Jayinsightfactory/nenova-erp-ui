const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

(async () => {
  process.chdir(path.join(__dirname, '..'));
  const envMod = await import('../lib/db.js');
  const { query } = envMod;
  const { getArrivalCostsForWeekRange } = await import('../lib/pivotFreightArrival.js');

  const farms = ['La Rosaleda', 'Krung', 'Cloudland', 'Holex', 'Royal Base', 'NZ Bloom '];
  for (const farm of farms) {
    const r = await query(
      `SELECT TOP 2 FarmName, OrderWeek, OrderNo FROM WarehouseMaster
       WHERE isDeleted=0 AND FarmName LIKE @f ORDER BY REPLACE(OrderWeek,'-','') DESC`,
      { f: { type: envMod.sql.NVarChar, value: `${farm}%` } },
    );
    console.log(farm.trim(), '→', r.recordset.map(x => `${x.OrderWeek} AWB:${x.OrderNo}`).join(' | ') || 'NONE');
  }

  const fc = await query(
    `SELECT wm.FarmName, wm.OrderWeek, COUNT(*) cnt
     FROM FreightCost fc JOIN WarehouseMaster wm ON fc.WarehouseKey=wm.WarehouseKey
     WHERE wm.OrderWeek IN ('24-01','24-02') AND wm.isDeleted=0
     GROUP BY wm.FarmName, wm.OrderWeek ORDER BY wm.FarmName`,
  );
  console.log('\nFreightCost snapshots 24-01/24-02:');
  fc.recordset.forEach(x => console.log(`  ${x.FarmName} ${x.OrderWeek}: ${x.cnt}`));

  const arrival = await getArrivalCostsForWeekRange({ weekStart: '24-01', weekEnd: '24-01', orderYear: '2026' });
  const keys = Object.keys(arrival);
  console.log(`\nPivot arrival map 24-01: ${keys.length} products`);
  const sampleNames = ['Electric MO', 'Mandala', 'Banker Bush', 'Anthurium', '호접란', 'Den. Big White'];
  for (const [pk, v] of Object.entries(arrival).slice(0, 5)) {
    console.log(`  prodKey=${pk} arrival=${Math.round(v.arrivalCost)} unit=${v.displayUnit} src=${v.source}`);
  }

  for (const term of sampleNames) {
    const r = await query(
      `SELECT TOP 1 p.ProdKey, p.ProdName FROM Product p WHERE p.isDeleted=0 AND p.ProdName LIKE @t`,
      { t: { type: envMod.sql.NVarChar, value: `%${term}%` } },
    );
    if (r.recordset[0]) {
      const pk = r.recordset[0].ProdKey;
      const a = arrival[pk];
      console.log(`  ${r.recordset[0].ProdName}: ${a ? Math.round(a.arrivalCost) + '원 (' + a.source + ')' : 'NO ARRIVAL'}`);
    }
  }
})().catch(console.error);
