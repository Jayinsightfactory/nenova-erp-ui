import assert from 'node:assert/strict';
import { buildPasteBatchChangeAudit, mergePasteRegisteredItems, pasteAuditChanged } from '../lib/pasteBatchHistory.js';

const audit = buildPasteBatchChangeAudit([
  { ok: true, type: 'CANCEL', prodKey: 10, prodName: '취소품목', orderQtyBefore: 1, orderQtyAfter: 0, outQtyBefore: 1, outQtyAfter: 0, unit: '박스' },
  { ok: true, type: 'CANCEL', prodKey: 20, prodName: '분배취소', orderQtyBefore: 5, orderQtyAfter: 5, outQtyBefore: 5, outQtyAfter: 3, unit: '단' },
  { ok: true, type: 'ADD', prodKey: 30, prodName: '추가품목', orderQtyBefore: 0, orderQtyAfter: 2, outQtyBefore: 0, outQtyAfter: 2, unit: '박스' },
]);

const rows = mergePasteRegisteredItems([
  { prodKey: 20, prodName: '분배취소', qty: 5 },
  { prodKey: 30, prodName: '추가품목', qty: 2 },
], audit);

assert.equal(rows.length, 3, 'DB 재조회에서 사라진 0수량 취소 품목도 감사 행으로 유지해야 한다.');
assert.equal(rows.find((row) => row.prodKey === 10)._auditOnly, true);
assert.equal(pasteAuditChanged(audit[20]), true, '주문수량이 같아도 분배수량 감소는 변경으로 표시해야 한다.');
assert.deepEqual(audit[10].actions, ['CANCEL']);
console.log('paste batch history tests passed');
