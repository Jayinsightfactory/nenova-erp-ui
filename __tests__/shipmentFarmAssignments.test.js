import assert from 'node:assert/strict';
import {
  normalizeFarmAssignments,
  farmAssignmentTotal,
  assertFarmAssignmentTotal,
} from '../lib/shipmentFarmAssignments.js';

const rows = normalizeFarmAssignments([
  { FarmKey: 10, ShipmentQuantity: 0.5 },
  { farmKey: 10, shipmentQuantity: 0.5 },
  { farmKey: 20, shipmentQuantity: 1 },
]);
assert.deepEqual(rows, [
  { farmKey: 10, shipmentQuantity: 1 },
  { farmKey: 20, shipmentQuantity: 1 },
]);
assert.equal(farmAssignmentTotal(rows), 2);
assert.equal(assertFarmAssignmentTotal(rows, 2), 2);
assert.throws(() => normalizeFarmAssignments([{ farmKey: 0, shipmentQuantity: 1 }]), /FarmKey/);
assert.throws(() => assertFarmAssignmentTotal(rows, 1), /다릅니다/);
console.log('shipmentFarmAssignments: all tests passed');
