import assert from 'node:assert/strict';
import {
  clearPendingEstimateOverflow,
  estimateOverflowPendingKey,
  inspectPendingEstimateOverflow,
  preparePendingEstimateOverflow,
  readPendingEstimateOverflow,
  readPendingEstimateOverflowStatus,
  runEstimateOverflowApplyOnce,
} from '../lib/estimateOverflowClient.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const storage = memoryStorage();
const scope = { orderYear: '2026', parentWeek: '36', custKey: 533 };
const body = {
  orderYear: '2026',
  custKey: 533,
  editGuard: { revision: 7 },
  items: [{ sdateKey: 88237, quantity: 60, unit: '박스', expectedOldQuantity: 50 }],
};
const preview = {
  required: true,
  planHash: 'plan-1',
  rows: [{ sdateKey: 88237, prodKey: 1239, fromWeek: '36-01', toWeek: '36-02', nextIncrease: 10 }],
};

assert.equal(estimateOverflowPendingKey(scope), 'nenova.estimate.overflow-pending.v1.2026.36.533');
const first = preparePendingEstimateOverflow({
  storage, scope, baseBody: body, preview, createOperationId: () => 'uuid-stable',
});
assert.equal(first.operationId, 'uuid-stable');
assert.equal(first.reused, false);
assert.equal(first.applyBody.overflowMode, 'apply');
assert.equal(first.applyBody.overflowPlanHash, 'plan-1');
assert.equal(first.applyBody.overflowConfirmed, true);

const reused = preparePendingEstimateOverflow({
  storage,
  scope,
  baseBody: { items: [{ unit: '박스', quantity: 60, sdateKey: 88237, expectedOldQuantity: 50 }], editGuard: { revision: 99, token: 'renewed-token' }, custKey: 533, orderYear: '2026' },
  preview: { ...preview, planHash: 'ignored-new-hash' },
  createOperationId: () => 'must-not-change',
});
assert.equal(reused.operationId, 'uuid-stable', 'same exact request reuses the pending operation UUID');
assert.equal(reused.applyBody.overflowPlanHash, 'plan-1', 'a pending operation keeps its exact confirmed apply body');
assert.deepEqual(reused.applyBody.editGuard, { revision: 7 }, 'renewed edit guard does not replace the stored exact apply body');
assert.equal(reused.reused, true);

assert.equal(inspectPendingEstimateOverflow(storage, scope, {
  ...body,
  items: [{ ...body.items[0], quantity: 61 }],
}).status, 'conflict', 'edited items cannot replace an unresolved operation');
assert.throws(() => preparePendingEstimateOverflow({
  storage,
  scope,
  baseBody: { ...body, items: [{ ...body.items[0], quantity: 61 }] },
  preview,
  createOperationId: () => 'uuid-new',
}), error => error.code === 'OVERFLOW_PENDING_CONFLICT');
assert.equal(readPendingEstimateOverflow(storage, scope).operationId, 'uuid-stable', 'conflicting input never changes the pending ID');

let postCount = 0;
let statusCount = 0;
const recovered = await runEstimateOverflowApplyOnce({
  operation: first,
  postApply: async () => {
    postCount += 1;
    throw Object.assign(new Error('gateway lost response'), { status: 504 });
  },
  readStatus: async operation => {
    statusCount += 1;
    assert.equal(operation.operationId, 'uuid-stable');
    return { success: true, found: true, result: { success: true, overflowApplied: true, items: [] } };
  },
});
assert.equal(recovered.status, 'success');
assert.equal(recovered.recovered, true);
assert.equal(postCount, 1, 'ambiguous apply is never posted automatically again');
assert.equal(statusCount, 1, 'ambiguous apply uses the read-only status endpoint');

postCount = 0;
statusCount = 0;
const unknown = await runEstimateOverflowApplyOnce({
  operation: first,
  postApply: async () => {
    postCount += 1;
    throw new TypeError('Failed to fetch');
  },
  readStatus: async () => {
    statusCount += 1;
    return { success: true, found: false };
  },
});
assert.equal(unknown.status, 'unknown');
assert.equal(postCount, 1);
assert.equal(statusCount, 1);
assert.equal(readPendingEstimateOverflow(storage, scope).operationId, 'uuid-stable', 'unknown result remains pending');

let readOnlyPostCount = 0;
const readOnlyUnknown = await readPendingEstimateOverflowStatus({
  pending: first,
  readStatus: async () => ({ success: true, found: false }),
  postApply: async () => { readOnlyPostCount += 1; },
});
assert.equal(readOnlyUnknown.status, 'unknown');
assert.equal(readOnlyPostCount, 0, 'status checking has no automatic write path');

const rolledBack = await runEstimateOverflowApplyOnce({
  operation: first,
  postApply: async () => {
    throw Object.assign(new Error('rollback'), {
      status: 409,
      code: 'OVERFLOW_STALE',
      data: { success: false, rolledBack: true, code: 'OVERFLOW_STALE', error: 'rollback' },
    });
  },
  readStatus: async () => { throw new Error('must not read a known rollback'); },
});
assert.equal(rolledBack.status, 'rolledBack');
assert.equal(rolledBack.data.rolledBack, true);

let rollback500StatusReads = 0;
const rolledBack500 = await runEstimateOverflowApplyOnce({
  operation: first,
  postApply: async () => {
    throw Object.assign(new Error('native verification rollback'), {
      status: 500,
      code: 'OVERFLOW_VERIFY_FAILED',
      data: { success: false, rolledBack: true, code: 'OVERFLOW_VERIFY_FAILED', error: 'native verification rollback' },
    });
  },
  readStatus: async () => { rollback500StatusReads += 1; return { success: true, found: false }; },
});
assert.equal(rolledBack500.status, 'rolledBack', 'structured HTTP 500 rollback is terminal');
assert.equal(rollback500StatusReads, 0, 'definite rollback does not probe an audit row or retry a write');

assert.equal(clearPendingEstimateOverflow(storage, scope, 'different-id'), false);
assert.equal(clearPendingEstimateOverflow(storage, scope, 'uuid-stable'), true);
assert.equal(readPendingEstimateOverflow(storage, scope), null);

console.log('estimateOverflowClient tests passed');
