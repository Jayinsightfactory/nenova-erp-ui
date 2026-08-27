import assert from 'node:assert/strict';
import { getEstimateGridNavigationTarget } from '../lib/estimateGridNavigation.js';

const cells = [
  { row: 0, column: 'quantity', id: 'q0' },
  { row: 0, column: 'cost', id: 'c0' },
  { row: 1, column: 'quantity', id: 'q1' },
  { row: 1, column: 'cost', id: 'c1' },
  { row: 2, column: 'quantity', id: 'q2', disabled: true },
  { row: 2, column: 'cost', id: 'c2' },
];

assert.equal(getEstimateGridNavigationTarget(cells, { row: 0, column: 'quantity' }, 'ArrowRight').id, 'c0');
assert.equal(getEstimateGridNavigationTarget(cells, { row: 0, column: 'cost' }, 'ArrowLeft').id, 'q0');
assert.equal(getEstimateGridNavigationTarget(cells, { row: 0, column: 'quantity' }, 'ArrowDown').id, 'q1');
assert.equal(getEstimateGridNavigationTarget(cells, { row: 0, column: 'cost' }, 'ArrowDown').id, 'c1');
assert.equal(getEstimateGridNavigationTarget(cells, { row: 2, column: 'cost' }, 'ArrowUp').id, 'c1');
assert.equal(getEstimateGridNavigationTarget(cells, { row: 1, column: 'quantity' }, 'ArrowDown'), null);
assert.equal(getEstimateGridNavigationTarget(cells, { row: 0, column: 'quantity' }, 'Enter'), null);

console.log('estimateGridNavigation tests passed');
