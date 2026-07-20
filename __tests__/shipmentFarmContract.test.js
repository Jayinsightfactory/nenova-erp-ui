import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (file) => fs.readFileSync(file, 'utf8');
const adjust = read('pages/api/shipment/adjust.js');
const farmApi = read('pages/api/shipment/farm-distribution.js');
const pivot = read('pages/shipment/week-pivot.js');
const evidence = read('docs/exe-golden/FormShipmentDistribution.md');

assert.match(adjust, /mode === 'PIVOT_DISTRIBUTION'|isPivotDistributionMode\(mode\)/);
assert.match(adjust, /SELECT COUNT\(\*\) AS cnt FROM ShipmentFarm/);
assert.match(adjust, /INSERT INTO ShipmentFarm \(FarmKey, ShipmentQuantity, SdetailKey\)/);
assert.match(farmApi, /DELETE FROM ShipmentFarm WHERE SdetailKey=@dk/);
assert.match(farmApi, /INSERT INTO ShipmentFarm \(FarmKey, ShipmentQuantity, SdetailKey\)/);
assert.match(pivot, /farmAssignments/);
assert.match(evidence, /ClassShipmentFarm\.Insert\(\)/);
assert.match(evidence, /read-only/);

console.log('shipmentFarmContract: all tests passed');
