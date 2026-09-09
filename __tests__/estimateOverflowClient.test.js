import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clearPendingEstimateOverflow,
  estimateOverflowPendingKey,
  inspectPendingEstimateOverflow,
  normalizeEstimateCombinedCostMode,
  preparePendingEstimateOverflow,
  readPendingEstimateOverflow,
  readPendingEstimateOverflowStatus,
  removeMatchingEstimateDrafts,
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

const combinedStorage = memoryStorage();
const combinedBody = {
  ...body,
  combinedCosts: {
    items: [{ shipmentKey: 9001, sdetailKey: 8001, expectedOldCost: 10000, cost: 12000 }],
    mode: 'once',
    week: '36-01',
  },
};
const combinedFirst = preparePendingEstimateOverflow({
  storage: combinedStorage,
  scope,
  baseBody: combinedBody,
  preview: { ...preview, combinedCostCount: 1 },
  createOperationId: () => 'uuid-combined',
});
const combinedReused = preparePendingEstimateOverflow({
  storage: combinedStorage,
  scope,
  baseBody: { ...combinedBody, editGuard: { revision: 101, token: 'rotated-combined-token' } },
  preview,
  createOperationId: () => 'must-not-change-combined',
});
assert.equal(combinedReused.operationId, 'uuid-combined', 'combined quantity+cost retry reuses its UUID after editGuard rotates');
assert.deepEqual(combinedReused.applyBody, combinedFirst.applyBody, 'combined retry reuses the exact stored apply body');
assert.equal(inspectPendingEstimateOverflow(combinedStorage, scope, {
  ...combinedBody,
  combinedCosts: { ...combinedBody.combinedCosts, items: [{ ...combinedBody.combinedCosts.items[0], cost: 12500 }] },
}).status, 'conflict', 'changed combined price is a different business request');
assert.equal(inspectPendingEstimateOverflow(combinedStorage, scope, {
  ...combinedBody,
  combinedCosts: { ...combinedBody.combinedCosts, mode: 'fixed' },
}).status, 'conflict', 'changed combined price mode is a different business request');
assert.equal(inspectPendingEstimateOverflow(combinedStorage, scope, {
  ...combinedBody,
  combinedCosts: { ...combinedBody.combinedCosts, week: '36-02' },
}).status, 'conflict', 'changed combined price week is a different business request');
assert.equal(inspectPendingEstimateOverflow(combinedStorage, scope, {
  ...body,
  combinedCosts: null,
}).status, 'conflict', 'an explicitly present combinedCosts value follows the server fingerprint exactly');

const committedDrafts = { 'date:7001': '60', 'estimate:99': '3', 'date:edited-again': '75' };
const reconciledDrafts = removeMatchingEstimateDrafts(committedDrafts, [
  { editKey: 'date:7001', draftValue: 60 },
  { editKey: 'date:edited-again', draftValue: 70 },
]);
assert.deepEqual(reconciledDrafts, {
  'estimate:99': '3',
  'date:edited-again': '75',
}, 'committed drafts clear while a newer in-flight edit and unrelated failed draft remain');

const fakeReactEvent = {};
fakeReactEvent.self = fakeReactEvent;
assert.equal(normalizeEstimateCombinedCostMode(fakeReactEvent, 'once'), 'once', 'a click event cannot enter the combined API payload');
assert.equal(normalizeEstimateCombinedCostMode('fixed', 'once'), 'fixed', 'an explicit fixed override is retained');
assert.equal(normalizeEstimateCombinedCostMode(undefined, 'weekFav'), 'weekFav', 'the selected fallback mode is retained');

const estimatePage = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');
const applyAllEditsSource = estimatePage.slice(
  estimatePage.indexOf('async function applyAllEdits'),
  estimatePage.indexOf('function closeCostModal'),
);
assert.ok(applyAllEditsSource.length > 0, 'applyAllEdits source boundary is available');
assert.doesNotMatch(applyAllEditsSource, /set(?:Qty|Cost)Edits\(\{\}\)/, 'combined save never blanket-clears newer quantity or cost drafts');
assert.match(applyAllEditsSource, /skippedCostDrafts[\s\S]*clearCommittedCostDrafts\(skippedCostDrafts\)/, 'deleted cost targets are reconciled explicitly');
assert.match(estimatePage, /onClick=\{\(\) => applyAllEdits\(\)\}/, 'the default combined-save button never forwards a React click event as mode');

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
