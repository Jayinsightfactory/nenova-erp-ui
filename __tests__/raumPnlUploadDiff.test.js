import assert from 'node:assert/strict';
import { diffRaumPnlUpload } from '../lib/raumPnlUploadDiff.js';

const existing = [
  { name: 'ROSE Freedom', unit: '단', qty: 10, supply: 100000, price: 10000 },
  { name: 'CARNATION Novia', unit: '단', qty: 5, supply: 55000, price: 11000 },
];
assert.equal(diffRaumPnlUpload(existing, existing).hasChanges, false);

const diff = diffRaumPnlUpload(existing, [
  { name: 'ROSE Freedom', unit: '단', qty: 12, supply: 120000, price: 10000 },
  { name: 'HYDRANGEA Blue', unit: '단', qty: 3, supply: 36000, price: 12000 },
]);
assert.equal(diff.hasChanges, true);
assert.equal(diff.changed[0].qtyDiff, 2);
assert.equal(diff.removed[0].name, 'CARNATION Novia');
assert.equal(diff.added[0].name, 'HYDRANGEA Blue');
assert.equal(diff.counts.supplyDelta, 1000);

const splitRows = diffRaumPnlUpload(
  [{ name: 'ROSE Freedom', unit: '단', qty: 10, supply: 100000, price: 10000 }],
  [{ name: 'ROSE Freedom', unit: '단', qty: 4, supply: 40000, price: 10000 }, { name: ' rose  freedom ', unit: '단', qty: 6, supply: 60000, price: 10000 }],
);
assert.equal(splitRows.hasChanges, true, '합계가 같아도 행 구성이 바뀌면 경고한다');
assert.equal(splitRows.changed.length, 0);

console.log('raumPnlUploadDiff.test.js passed');
