import assert from 'node:assert/strict';
import {
  classifyEstimateSaveSnapshot,
  estimateEditDraftKey,
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
});
assert.equal(finalResponseLossRequests, 4);
assert.equal(finalResponseLoss.alreadyApplied, true, '마지막 재요청의 응답만 유실돼도 중복 POST 없이 반영 완료로 판정한다');

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

console.log('estimateSaveRecovery tests passed');
