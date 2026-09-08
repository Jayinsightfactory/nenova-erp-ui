import assert from 'node:assert/strict';
import {
  boundedStockBusyDelayMs,
  classifyEstimateSaveSnapshot,
  estimateEditDraftKey,
  ESTIMATE_SAVE_STOCK_BUSY_DELAYS_MS,
  ESTIMATE_SAVE_STOCK_BUSY_MAX_RETRIES,
  ESTIMATE_SAVE_STOCK_BUSY_MAX_TOTAL_DELAY_MS,
  isTransientEstimateSaveFailure,
  readEstimateEditDraft,
  runRecoverableEstimateSave,
  writeEstimateEditDraft,
} from '../lib/estimateSaveRecovery.js';

const storageValues = new Map();
const storage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: key => storageValues.delete(key),
};

const scope = { orderYear: '2026', parentWeek: '34', custKey: 123 };
assert.equal(estimateEditDraftKey(scope), 'nenova.estimate.edit-draft.v1.2026.34.123');
assert.equal(writeEstimateEditDraft(storage, scope, {
  qtyEdits: { 'sdate:1': '12' },
  costEdits: { 'sd:2@2026-08-20': '13000' },
  costMode: 'fixed',
}), true);
assert.deepEqual(readEstimateEditDraft(storage, scope), {
  qtyEdits: { 'sdate:1': '12' },
  costEdits: { 'sd:2@2026-08-20': '13000' },
  costMode: 'fixed',
  updatedAt: readEstimateEditDraft(storage, scope).updatedAt,
});
writeEstimateEditDraft(storage, scope, { qtyEdits: {}, costEdits: {} });
assert.equal(readEstimateEditDraft(storage, scope), null);

assert.equal(isTransientEstimateSaveFailure(Object.assign(new Error('bad gateway'), { status: 502 })), true);
assert.equal(isTransientEstimateSaveFailure(Object.assign(new Error('conflict'), { status: 409 })), false);
assert.equal(isTransientEstimateSaveFailure(new TypeError('Failed to fetch')), true);
assert.equal(isTransientEstimateSaveFailure(Object.assign(new Error('timeout'), { name: 'AbortError' })), true);
assert.equal(ESTIMATE_SAVE_STOCK_BUSY_MAX_RETRIES, 5);
assert.equal(ESTIMATE_SAVE_STOCK_BUSY_DELAYS_MS.reduce((total, delay) => total + delay, 0), ESTIMATE_SAVE_STOCK_BUSY_MAX_TOTAL_DELAY_MS);
assert.equal(boundedStockBusyDelayMs(60_000), ESTIMATE_SAVE_STOCK_BUSY_MAX_TOTAL_DELAY_MS, 'large custom waits cannot exceed the total stock-gate budget');
assert.equal(boundedStockBusyDelayMs(60_000, 14_500), 500, 'a later custom wait receives only the remaining stock-gate budget');

const rows = [
  { SdateKey: 10, SdetailKey: 20, Quantity: 7, DateCost: 12000, Cost: 12000 },
  { EstimateKey: 30, SdetailKey: null, Quantity: -2, Cost: 3000 },
  { SdetailKey: 40, EstimateKey: null, Quantity: 5, Cost: 8000 },
];
assert.equal(classifyEstimateSaveSnapshot({
  intents: [{ kind: 'date', field: 'quantity', key: 10, expected: 6, desired: 7 }], rows,
}).status, 'applied');
assert.equal(classifyEstimateSaveSnapshot({
  intents: [{ kind: 'estimate', field: 'cost', key: 30, expected: 3000, desired: 3500 }], rows,
}).status, 'unchanged');
assert.equal(classifyEstimateSaveSnapshot({
  intents: [{ kind: 'detail', field: 'cost', key: 40, expected: 7000, desired: 8000 }], rows,
}).status, 'applied');
assert.equal(classifyEstimateSaveSnapshot({
  intents: [{ kind: 'date', field: 'quantity', key: 999, expected: 1, desired: 0 }], rows,
}).status, 'applied');
assert.equal(classifyEstimateSaveSnapshot({
  intents: [{ kind: 'date', field: 'quantity', key: 10, expected: 5, desired: 9 }], rows,
}).status, 'conflict');

let appliedRequests = 0;
const applied = await runRecoverableEstimateSave({
  request: async () => {
    appliedRequests += 1;
    throw new TypeError('Failed to fetch');
  },
  probe: async () => true,
  reconcile: async () => ({ status: 'applied', data: { success: true, changedCount: 1 } }),
  delays: [0],
});
assert.equal(appliedRequests, 1, '응답만 유실된 저장은 중복 POST하지 않는다');
assert.equal(applied.alreadyApplied, true);

let retryRequests = 0;
const retried = await runRecoverableEstimateSave({
  request: async () => {
    retryRequests += 1;
    if (retryRequests === 1) throw Object.assign(new Error('deploying'), { status: 503 });
    return { success: true };
  },
  probe: async () => true,
  reconcile: async () => ({ status: 'unchanged' }),
  delays: [0],
});
assert.equal(retryRequests, 2, '입력 전 상태일 때만 한 번 다시 저장한다');
assert.equal(retried.recovered, true);

let repeatedDeployRequests = 0;
let repeatedDeployReconciles = 0;
const repeatedDeploy = await runRecoverableEstimateSave({
  request: async () => {
    repeatedDeployRequests += 1;
    if (repeatedDeployRequests < 4) throw Object.assign(new Error('deploying again'), { status: 502 });
    return { success: true, changedCount: 1 };
  },
  probe: async () => true,
  reconcile: async () => {
    repeatedDeployReconciles += 1;
    return { status: 'unchanged' };
  },
  delays: [0],
});
assert.equal(repeatedDeployRequests, 4, '연속 배포로 복구 직후 다시 끊겨도 안전 대조 후 재처리를 이어간다');
assert.equal(repeatedDeployReconciles, 3, '각 실패 뒤 원장값이 입력 전 상태인지 다시 확인한다');
assert.equal(repeatedDeploy.recovered, true);

let finalResponseLossRequests = 0;
const finalResponseLoss = await runRecoverableEstimateSave({
  request: async () => {
    finalResponseLossRequests += 1;
    throw Object.assign(new Error('response lost'), { status: 504 });
  },
  probe: async () => true,
  reconcile: async () => finalResponseLossRequests === 4
    ? { status: 'applied', data: { success: true, changedCount: 1 } }
    : { status: 'unchanged' },
  delays: [0],
  commitObservationDelays: [0],
});
assert.equal(finalResponseLossRequests, 4);
assert.equal(finalResponseLoss.alreadyApplied, true, '마지막 재요청의 응답만 유실돼도 중복 POST 없이 반영 완료로 판정한다');

let slowCommitRequests = 0;
let slowCommitReconciles = 0;
const slowCommit = await runRecoverableEstimateSave({
  request: async () => {
    slowCommitRequests += 1;
    throw Object.assign(new Error('browser timeout'), { name: 'AbortError' });
  },
  probe: async () => true,
  reconcile: async () => {
    slowCommitReconciles += 1;
    return slowCommitReconciles >= 3
      ? { status: 'applied', data: { success: true, changedCount: 1 } }
      : { status: 'unchanged' };
  },
  delays: [0],
  commitObservationDelays: [0, 0, 0],
});
assert.equal(slowCommitRequests, 1, '시간이 오래 걸린 최초 저장이 진행 중이면 같은 POST를 다시 보내지 않는다');
assert.equal(slowCommitReconciles, 3, '입력 전 값이 보여도 진행 중인 트랜잭션의 완료를 재조회한다');
assert.equal(slowCommit.alreadyApplied, true);

let businessRequests = 0;
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    businessRequests += 1;
    throw Object.assign(new Error('stale'), { status: 409, code: 'STALE_DATA' });
  },
  probe: async () => true,
  reconcile: async () => ({ status: 'unchanged' }),
  delays: [0],
}), error => error.code === 'STALE_DATA');
assert.equal(businessRequests, 1, '업무 충돌은 자동 재시도하지 않는다');

const retryableStockBusy = () => Object.assign(new Error('stock gate busy'), {
  status: 409,
  code: 'STOCK_GATE_BUSY',
  data: { retryable: true, saved: false },
});

let stockBusySuccessRequests = 0;
const stockBusyStates = [];
const stockBusySuccess = await runRecoverableEstimateSave({
  request: async () => {
    stockBusySuccessRequests += 1;
    if (stockBusySuccessRequests === 1) throw retryableStockBusy();
    return { success: true };
  },
  onState: state => stockBusyStates.push(state),
  stockBusyDelays: [0],
});
assert.equal(stockBusySuccessRequests, 2, 'known no-write stock gate busy retries the same save once');
assert.equal(stockBusySuccess.recovered, true);
assert.deepEqual(stockBusyStates.map(({ phase, waitAttempt, delayMs }) => ({ phase, waitAttempt, delayMs })), [
  { phase: 'stock-wait', waitAttempt: 1, delayMs: 0 },
]);

let stockBusyExhaustedRequests = 0;
const stockBusyTerminalStates = [];
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    stockBusyExhaustedRequests += 1;
    throw retryableStockBusy();
  },
  onState: state => stockBusyTerminalStates.push(state),
  stockBusyDelays: [0],
}), error => error.code === 'STOCK_GATE_BUSY' && /입력값은 그대로 보관/.test(error.message));
assert.equal(stockBusyExhaustedRequests, 6, 'stock gate retries are bounded separately from network request retries');
assert.equal(stockBusyTerminalStates.at(-1).phase, 'stockbusy');
assert.equal(stockBusyTerminalStates.at(-1).preservesInput, true);

let acknowledgedBusinessConflictRequests = 0;
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    acknowledgedBusinessConflictRequests += 1;
    throw Object.assign(new Error('shortage'), {
      status: 409,
      code: 'STOCK_SHORTAGE',
      data: { retryable: true, saved: false },
    });
  },
  stockBusyDelays: [0],
}), error => error.code === 'STOCK_SHORTAGE');
assert.equal(acknowledgedBusinessConflictRequests, 1, 'business conflicts never use stock gate retry');

let unacknowledgedStockBusyRequests = 0;
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    unacknowledgedStockBusyRequests += 1;
    throw Object.assign(new Error('stock gate busy'), { status: 409, code: 'STOCK_GATE_BUSY', data: { retryable: true } });
  },
  stockBusyDelays: [0],
}), error => error.code === 'STOCK_GATE_BUSY');
assert.equal(unacknowledgedStockBusyRequests, 1, 'missing saved:false acknowledgement never retries');

let unacknowledgedStockBusy503Requests = 0;
const unacknowledgedStockBusy503 = Object.assign(new Error('stock gate busy'), {
  status: 503,
  code: 'STOCK_GATE_BUSY',
  data: { retryable: true },
});
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    unacknowledgedStockBusy503Requests += 1;
    throw unacknowledgedStockBusy503;
  },
}), error => error === unacknowledgedStockBusy503);
assert.equal(unacknowledgedStockBusy503Requests, 1, 'an unacknowledged stock busy error never falls through to 503 recovery');

for (const businessCode of ['ERP_EDIT_STALE', 'ERP_EDIT_LOCKED']) {
  let business503Requests = 0;
  const business503 = Object.assign(new Error(businessCode), { status: 503, code: businessCode });
  await assert.rejects(() => runRecoverableEstimateSave({
    request: async () => {
      business503Requests += 1;
      throw business503;
    },
  }), error => error === business503);
  assert.equal(business503Requests, 1, `${businessCode} takes precedence over transient HTTP status`);
}

let zeroRetryStockBusyRequests = 0;
const zeroRetryStockBusyStates = [];
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    zeroRetryStockBusyRequests += 1;
    throw retryableStockBusy();
  },
  onState: state => zeroRetryStockBusyStates.push(state),
  maxStockBusyRetries: 0,
}), error => error.code === 'STOCK_GATE_BUSY');
assert.equal(zeroRetryStockBusyRequests, 1, 'an explicit zero stock-busy retry limit sends no retry request');
assert.deepEqual(zeroRetryStockBusyStates.map(({ phase, waitAttempt }) => ({ phase, waitAttempt })), [
  { phase: 'stockbusy', waitAttempt: 0 },
]);

let busyThenStaleRequests = 0;
await assert.rejects(() => runRecoverableEstimateSave({
  request: async () => {
    busyThenStaleRequests += 1;
    if (busyThenStaleRequests === 1) throw retryableStockBusy();
    throw Object.assign(new Error('stale'), { status: 409, code: 'STALE_DATA' });
  },
  stockBusyDelays: [0],
}), error => error.code === 'STALE_DATA');
assert.equal(busyThenStaleRequests, 2, 'a later stale conflict stops stock retries immediately');

let mixedRecoveryRequests = 0;
let mixedRecoveryReconciles = 0;
const mixedRecovery = await runRecoverableEstimateSave({
  request: async () => {
    mixedRecoveryRequests += 1;
    if (mixedRecoveryRequests === 1) throw retryableStockBusy();
    throw Object.assign(new Error('response lost'), { status: 504 });
  },
  probe: async () => true,
  reconcile: async () => {
    mixedRecoveryReconciles += 1;
    return { status: 'applied', data: { success: true } };
  },
  stockBusyDelays: [0],
  delays: [0],
  commitObservationDelays: [0],
});
assert.equal(mixedRecoveryRequests, 2, 'network recovery after a stock wait does not send a duplicate request');
assert.equal(mixedRecoveryReconciles, 1, 'network recovery still reconciles an ambiguous commit');
assert.equal(mixedRecovery.alreadyApplied, true);

console.log('estimateSaveRecovery tests passed');
