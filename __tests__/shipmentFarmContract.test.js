import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (file) => fs.readFileSync(file, 'utf8');
const adjust = read('pages/api/shipment/adjust.js');
const farmApi = read('pages/api/shipment/farm-distribution.js');
const traceApi = read('pages/api/shipment/item-trace.js');
const repairPage = read('pages/admin/distribute-repair.js');
const pivot = read('pages/shipment/week-pivot.js');
const evidence = read('docs/exe-golden/FormShipmentDistribution.md');
const farmCandidates = read('lib/shipmentFarmCandidates.js');

assert.match(adjust, /mode === 'PIVOT_DISTRIBUTION'|isPivotDistributionMode\(mode\)/);
assert.match(adjust, /SELECT COUNT\(\*\) AS cnt FROM ShipmentFarm/);
assert.match(adjust, /INSERT INTO ShipmentFarm \(FarmKey, ShipmentQuantity, SdetailKey\)/);
assert.match(adjust, /FARM_CANDIDATE_SCOPE_SQL/);
assert.match(adjust, /FROM ViewWarehouse vw\s+JOIN Farm f ON vw\.FarmName=f\.FarmName[\s\S]*?WHERE \$\{FARM_CANDIDATE_SCOPE_SQL\}/);
assert.doesNotMatch(adjust, /WHERE vw\.OrderYear=@yr AND vw\.OrderWeek=@wk AND vw\.ProdKey=@pk/);
assert.match(farmApi, /DELETE FROM ShipmentFarm WHERE SdetailKey=@dk/);
assert.match(farmApi, /INSERT INTO ShipmentFarm \(FarmKey, ShipmentQuantity, SdetailKey\)/);
assert.match(farmApi, /FARM_CANDIDATE_SCOPE_SQL/);
assert.match(farmApi, /FROM ViewWarehouse vw[\s\S]*?WHERE \$\{FARM_CANDIDATE_SCOPE_SQL\}/);
assert.doesNotMatch(farmApi, /WHERE vw\.OrderYear=@yr AND vw\.OrderWeek=@wk AND vw\.ProdKey=@pk/);
assert.match(farmCandidates, /FARM_CANDIDATE_SCOPE_SQL\s*=\s*'vw\.ProdKey=@pk'/);
assert.match(farmCandidates, /yearScoped:\s*false/);
assert.match(farmCandidates, /weekScoped:\s*false/);
assert.match(traceApi, /om\.OrderYear=@yr AND om\.OrderWeek=@wk/);
assert.match(traceApi, /sm\.OrderYear=@yr AND sm\.OrderWeek=@wk/);
assert.match(repairPage, /item-trace', \{ year, week, q:/);
assert.match(pivot, /farmAssignments/);
assert.match(evidence, /ClassShipmentFarm\.Insert\(\)/);
assert.match(evidence, /read-only/);

console.log('shipmentFarmContract: all tests passed');
