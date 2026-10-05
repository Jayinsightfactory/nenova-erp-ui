import assert from 'node:assert/strict';
import { fixStatusLabel } from '../lib/fixStatusDisplay.js';

assert.equal(fixStatusLabel('FIXED'), '전체확정');
assert.equal(fixStatusLabel('PARTIAL'), '부분확정');
assert.equal(fixStatusLabel('UNFIXED'), '미확정');
assert.equal(fixStatusLabel('FIXED_PENDING_STOCK'), '출고확정·재고미정합');
assert.equal(fixStatusLabel('NO_SHIPMENT'), '출고없음');
assert.equal(fixStatusLabel('UNKNOWN'), '출고없음');

console.log('fix status display labels passed');

