'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPasteWorkspaceKey,
  buildPasteWorkspaceFingerprint,
  savePasteWorkspace,
  loadPasteWorkspace,
  loadPasteWorkspaceLastWeek,
} = require('../lib/pasteWorkspace');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

const sampleState = () => ({
  pasteText: '38-01 테스트 주문',
  excludedLines: [2],
  evidenceMessages: [{ id: 77, text: '확인 메시지' }],
  baseInput: '기준 입력',
  remainInput: '잔량 입력',
  baseMatches: [{ inputName: '장미', prodKey: 12 }],
  stockBaseWeek: '2026-37-01',
  orders: [{
    id: 'order-1', custMatch: { CustKey: 5, CustName: '테스트 거래처' },
    items: [{ inputName: '장미', prodKey: 12, qty: 2, qtyExpression: '1+1', action: 'ADD', skip: false }],
  }],
});

test('workspace keys are canonical and isolate actor and cross-year week', () => {
  assert.equal(buildPasteWorkspaceKey('user a', '2026-38-01'), 'nenova:orders-paste:workspace:v1:user%20a:2026-38-01');
  assert.notEqual(buildPasteWorkspaceKey('user-a', '2026-38-01'), buildPasteWorkspaceKey('user-b', '2026-38-01'));
  assert.notEqual(buildPasteWorkspaceKey('user-a', '2025-38-01'), buildPasteWorkspaceKey('user-a', '2026-38-01'));
  assert.equal(buildPasteWorkspaceKey('user-a', '2026-38'), null);
  assert.equal(buildPasteWorkspaceKey('user-a', '2026-54-01'), null);
});

test('save/load preserve whitelisted draft intent, isolate actors and update actor last-week pointer', () => {
  const storage = memoryStorage();
  const state = sampleState();
  state.unrelatedRuntime = 'drop';
  state.orders[0].saving = true;
  state.orders[0].editGuard = { owner: 'other' };
  state.orders[0].items[0].lease = 'secret';
  state.orders[0].items[0].apiToken = 'secret';
  savePasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', state });

  const restored = loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01' });
  assert.equal(restored.state.pasteText, state.pasteText);
  assert.deepEqual(restored.state.excludedLines, [2]);
  assert.deepEqual(restored.state.evidenceMessages, state.evidenceMessages);
  assert.deepEqual(restored.state.baseMatches, state.baseMatches);
  assert.equal(restored.state.orders[0].items[0].qtyExpression, '1+1');
  assert.equal(restored.state.orders[0].saving, undefined);
  assert.equal(restored.state.orders[0].editGuard, undefined);
  assert.equal(restored.state.orders[0].items[0].lease, undefined);
  assert.equal(restored.state.orders[0].items[0].apiToken, undefined);
  assert.equal(restored.state.unrelatedRuntime, undefined);
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-b', week: '2026-38-01' }), null);
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a', week: '2025-38-01' }), null);
  assert.equal(loadPasteWorkspaceLastWeek(storage, 'user-a'), '2026-38-01');
  assert.equal(loadPasteWorkspaceLastWeek(storage, 'user-b'), null);
});

test('fingerprint follows editing intent including mixed quantity expressions', () => {
  const input = { week: '2026-38-01', pasteText: 'same', orders: sampleState().orders };
  assert.equal(buildPasteWorkspaceFingerprint(input), buildPasteWorkspaceFingerprint(input));
  assert.notEqual(buildPasteWorkspaceFingerprint(input), buildPasteWorkspaceFingerprint({
    ...input, orders: [{ ...input.orders[0], items: [{ ...input.orders[0].items[0], qtyExpression: '1+2' }] }],
  }));
  assert.notEqual(buildPasteWorkspaceFingerprint(input), buildPasteWorkspaceFingerprint({ ...input, pasteText: 'changed' }));
  assert.notEqual(
    buildPasteWorkspaceFingerprint({ ...input, evidenceMessages: [{ identity: 'kakao-message-a' }] }),
    buildPasteWorkspaceFingerprint({ ...input, evidenceMessages: [{ identity: 'kakao-message-b' }] }),
  );
  assert.equal(
    buildPasteWorkspaceFingerprint({ ...input, evidenceMessages: [{ identity: ' k-id ' }, {}, { identity: 'k-id' }] }),
    buildPasteWorkspaceFingerprint({ ...input, evidenceMessages: [{ identity: 'k-id' }] }),
    'valid source identities are trimmed, deduplicated and order independent',
  );
});

test('only verified full success restores completion and matching fingerprint is required', () => {
  const storage = memoryStorage();
  const state = sampleState();
  const fingerprint = buildPasteWorkspaceFingerprint({ week: '2026-38-01', pasteText: state.pasteText, orders: state.orders, evidenceMessages: state.evidenceMessages });
  const success = { orderId: 'ALL', okCount: 2, failCount: 0, rolledBack: false, undone: false, details: [{ ok: true, id: 1 }, { ok: true, id: 2 }] };
  success.verified = true;
  savePasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', state: { ...state, bulkResult: success }, completionFingerprint: fingerprint });
  const restored = loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', currentFingerprint: fingerprint });
  assert.deepEqual(restored.state.bulkResult.details.map((row) => row.ok), [true, true]);
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', currentFingerprint: `${fingerprint}!` }).state.bulkResult, undefined);
  const otherSourceFingerprint = buildPasteWorkspaceFingerprint({ week: '2026-38-01', pasteText: state.pasteText, orders: state.orders, evidenceMessages: [{ identity: 'different-message' }] });
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', currentFingerprint: otherSourceFingerprint }).state.bulkResult, undefined);

  for (const result of [
    { verified: true, orderId: 'ALL', okCount: 2, failCount: 1, details: [{ ok: true }, { ok: false }] },
    { verified: true, orderId: 'ALL', okCount: 0, failCount: 0, details: [] },
    { verified: true, orderId: 'ALL', okCount: 2, failCount: 0, rolledBack: true, details: [{ ok: true }, { ok: true }] },
    { verified: true, orderId: 'ALL', okCount: 2, failCount: 0, undone: true, details: [{ ok: true }, { ok: true }] },
  ]) {
    savePasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', state: { ...state, bulkResult: result }, completionFingerprint: fingerprint });
    assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', currentFingerprint: fingerprint }).state.bulkResult, undefined);
  }
});

test('actor-only load follows last-week pointer and rejects a changed stored draft fingerprint', () => {
  const storage = memoryStorage();
  const state = sampleState();
  savePasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', state });
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a' }).week, '2026-38-01');
  const key = buildPasteWorkspaceKey('user-a', '2026-38-01');
  const snapshot = JSON.parse(storage.getItem(key));
  snapshot.state.orders[0].items[0].qty = 99;
  storage.setItem(key, JSON.stringify(snapshot));
  assert.equal(loadPasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01' }), null);
});

test('storage quota errors propagate to the caller', () => {
  const storage = { setItem() { throw new Error('quota exceeded'); } };
  assert.throws(() => savePasteWorkspace(storage, { actorId: 'user-a', week: '2026-38-01', state: sampleState() }), /quota exceeded/);
});
