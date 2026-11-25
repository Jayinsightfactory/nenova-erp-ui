import assert from 'node:assert/strict';
import { defectCarryoverAllowed, defectCarryoverApproval } from '../lib/defectCarryoverChoice.js';

const current = { OrderYear: 2026, OrderWeek: '47-01', CustKey: 13 };
const prior = { ...current, OrderWeek: '46' };
const lastYear = { ...current, OrderYear: 2025 };
const approval = defectCarryoverApproval(2026, '46', 13);

assert.equal(defectCarryoverAllowed(current, 2026, '47'), true);
assert.equal(defectCarryoverAllowed(prior, 2026, '47'), false);
assert.equal(defectCarryoverAllowed(prior, 2026, '47', approval), true);
assert.equal(defectCarryoverAllowed(lastYear, 2026, '47'), false);
assert.equal(defectCarryoverAllowed(lastYear, 2026, '47', approval), false);
assert.equal(defectCarryoverAllowed(current, 2026, '47', approval), false);
assert.equal(defectCarryoverAllowed({ ...prior, CustKey: 14 }, 2026, '47', approval), false);
assert.equal(defectCarryoverAllowed({ ...prior, OrderWeek: '45' }, 2026, '47', approval), false);
assert.equal(defectCarryoverAllowed({ ...prior, OrderWeek: '' }, 2026, '47'), false);
