import assert from 'node:assert/strict';
import { assertShipmentDistributionVerification } from '../lib/shipmentDistributionVerification.js';

assert.deepEqual(
  assertShipmentDistributionVerification({ expectedQty: 10, detailCount: 1, detailQty: 10, dateQty: 10 }),
  { detailCount: 1, detailQty: 10, dateQty: 10 },
);
assert.deepEqual(
  assertShipmentDistributionVerification({ expectedQty: 0, detailCount: 0, detailQty: 0, dateQty: 0 }),
  { detailCount: 0, detailQty: 0, dateQty: 0 },
);
assert.throws(
  () => assertShipmentDistributionVerification({ expectedQty: 10, detailCount: 1, detailQty: 10, dateQty: 9 }),
  /출고일 9/,
);
assert.throws(
  () => assertShipmentDistributionVerification({ expectedQty: 10, detailCount: 2, detailQty: 10, dateQty: 10 }),
  /상세행 2/,
);
assert.throws(
  () => assertShipmentDistributionVerification({ expectedQty: 0, detailCount: 1, detailQty: 0, dateQty: 0 }),
  /상세행 1/,
);

console.log('shipmentDistributionVerification: all tests passed');
