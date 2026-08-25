const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { normalizePasteUndoBatch, runPasteUndoBatchTransaction } = await import('../lib/pasteBatchUndo.js');
  const { resolvePivotAdjustmentPolicy } = await import('../lib/pivotAdjustmentPolicy.js');
  const undo = normalizePasteUndoBatch({
    year: '2026', week: '33-02', entries: [
      { originalType: 'CANCEL', custKey: 1, prodKey: 10, qty: 2, unit: '박스', orderQtyAfter: 7, outQtyAfter: 1, editGuard: { token: 'lease-1' } },
      { originalType: 'ADD', custKey: 2, prodKey: 20, qty: 2, unit: '박스', orderQtyAfter: 20, outQtyAfter: 20 },
    ],
  });
  assert.deepEqual(undo.entries.map(row => row.originalType), ['ADD', 'CANCEL'], '되돌리기는 원래 ADD 제거 후 원래 CANCEL 복원 순서여야 한다.');
  assert.equal(undo.entries[0].body.mode, 'PASTE_UNDO_BOTH');
  assert.equal(undo.entries[0].body.type, 'CANCEL');
  assert.equal(undo.entries[1].body.mode, 'PASTE_UNDO_SHIPMENT_ONLY');
  assert.equal(undo.entries[1].body.type, 'ADD');
  assert.ok(undo.entries.every(row => row.body.force === false));
  assert.equal(
    undo.entries.find(row => row.originalType === 'CANCEL').body.editGuard.token,
    'lease-1',
    '되돌리기도 같은 업체 작업권을 서버까지 전달해야 한다.',
  );
  assert.throws(() => normalizePasteUndoBatch({ year: '2026', week: '33-02', entries: [
    { originalType: 'ADD', custKey: 1, prodKey: 10, qty: 1, unit: '박스' },
  ] }), /처리 직후 수량/, '처리 직후 예상값 없는 되돌리기는 차단해야 한다.');

  const noShipmentCancel = resolvePivotAdjustmentPolicy({ mode: 'AUTO_CANCEL', type: 'CANCEL', hasActiveOrder: true, hasActiveShipment: false });
  assert.equal(noShipmentCancel.mutateOrder, false, '분배취소는 활성 분배가 없어도 주문을 수정하면 안 된다.');
  assert.equal(noShipmentCancel.mutateShipment, true, '활성 분배가 없으면 분배 저장 단계에서 실패해야 한다.');

  const adjustSource = fs.readFileSync('pages/api/shipment/adjust.js', 'utf8');
  assert.match(adjustSource, /type === 'ADD' && !undoShipmentOnly/, '분배-only 복원은 누락 주문을 새로 만들면 안 된다.');
  assert.match(adjustSource, /expectedOrderQty[\s\S]*PASTE_UNDO_STATE_CHANGED/);
  assert.match(adjustSource, /expectedShipmentQty[\s\S]*PASTE_UNDO_STATE_CHANGED/);

  let committed = [];
  const atomicRows = await runPasteUndoBatchTransaction({
    batch: undo,
    user: { userId: 'tester' },
    capabilities: {},
    withTransactionFn: async (callback) => {
      const pending = [];
      const result = await callback(pending);
      committed = pending.slice();
      return result;
    },
    executeEntryFn: async (pending, { body }) => {
      pending.push(`${body.custKey}:${body.prodKey}`);
      return { success: true, verified: true };
    },
  });
  assert.equal(atomicRows.length, 2);
  assert.deepEqual(committed, ['2:20', '1:10']);

  committed = [];
  await assert.rejects(() => runPasteUndoBatchTransaction({
    batch: undo,
    user: { userId: 'tester' },
    capabilities: {},
    withTransactionFn: async (callback) => {
      const pending = [];
      const result = await callback(pending);
      committed = pending.slice();
      return result;
    },
    executeEntryFn: async (pending, { body }) => {
      pending.push(`${body.custKey}:${body.prodKey}`);
      return { success: true, verified: pending.length === 1 };
    },
  }), /전산 대조/);
  assert.deepEqual(committed, [], '중간 검증 실패 시 전체 트랜잭션이 커밋되면 안 된다.');

  const undoApiSource = fs.readFileSync('pages/api/shipment/adjust-batch-undo.js', 'utf8');
  assert.match(undoApiSource, /verified:\s*true/);
  assert.match(undoApiSource, /committedCount:\s*results\.length/);
  const pastePageSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
  assert.match(pastePageSource, /undoGuards = await acquireAllPasteGuards/);
  assert.match(pastePageSource, /editGuard: guardByCust\.get/);
  assert.match(pastePageSource, /AbortController/);
  assert.match(pastePageSource, /refreshBaseline: undoSucceeded/);

  console.log('paste batch undo tests passed');
}

main().catch(error => { console.error(error); process.exit(1); });
