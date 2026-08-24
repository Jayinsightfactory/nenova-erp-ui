import assert from 'node:assert/strict';
import {
  mergeRegisterItems,
  setImportItemsSkip,
  importSkipCounts,
  pickImportRegisteredOrder,
  importWriteStatusLabel,
  buildImportRegisterResult,
} from '../lib/orderImportRegister.js';

const rows = [
  { inputName: 'Doncel', prodKey: 1, prodName: 'Doncel', qty: 2, unit: '박스', skip: false },
  { inputName: 'Mondial', prodKey: 2, prodName: 'Mondial', qty: 3, unit: '박스', skip: false },
  { inputName: '미매칭', prodKey: null, qty: 1, unit: '단', skip: false },
];

const allSkip = setImportItemsSkip(rows, true);
assert.equal(importSkipCounts(allSkip).allSkipped, true);
assert.equal(importSkipCounts(allSkip).skipped, 3);
assert.equal(mergeRegisterItems(allSkip).length, 0, '전체 제외면 주문등록 대상이 없어야 한다');

const noneSkip = setImportItemsSkip(allSkip, false);
assert.equal(importSkipCounts(noneSkip).noneSkipped, true);
assert.equal(mergeRegisterItems(noneSkip.filter((it) => it.prodKey)).length, 2);

const picked = pickImportRegisteredOrder([
  { custName: '라움', year: '2025', week: '34-01', items: [{ prodKey: 9, qty: 1 }] },
  { custName: '라움', year: '2026', week: '34-01', items: [{ prodKey: 1, qty: 5, prodName: 'Doncel', unit: '박스' }] },
], '라움', '2026-34-01');
assert.equal(picked.year, '2026');
assert.equal(picked.items[0].qty, 5);

assert.equal(importWriteStatusLabel('ADDED'), '추가');
assert.equal(importWriteStatusLabel('OK'), '신규');

const result = buildImportRegisterResult({
  apiResults: [{ prodKey: 1, prodName: 'Doncel', previousQty: 0, deltaQty: 2, finalQty: 2, status: 'OK', unit: '박스' }],
  dbOrder: picked,
  skippedItems: [{ inputName: '미매칭', skip: true, qty: 1, unit: '단' }],
  orderMasterKey: 88,
});
assert.equal(result.orderMasterKey, 88);
assert.equal(result.writeRows.length, 1);
assert.equal(result.dbItems.length, 1);
assert.equal(result.skippedItems[0].reason, '제외');

console.log('order import register helpers passed');
