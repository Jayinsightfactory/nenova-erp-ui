import assert from 'node:assert/strict';
import {
  mergeRegisterItems,
  setImportItemsSkip,
  importSkipCounts,
  pickImportRegisteredOrder,
  importWriteStatusLabel,
  buildImportRegisterResult,
  buildImportMatchAggregates,
  buildImportInlineMatchRows,
  findOrderImportMatchInsertIndex,
  findImportMixedUnitProducts,
  sortImportRowsByProductOrder,
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
assert.equal(importWriteStatusLabel('UNCHANGED'), '동일');

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

const aggregates = buildImportMatchAggregates([
  { rowNo: 4, inputName: 'Novia', prodKey: 456, prodName: 'CARNATION Novia', displayName: 'Novia', flowerName: '카네이션', counName: '콜롬비아', qty: 10, unit: '박스' },
  { rowNo: 8, inputName: '노비아', prodKey: 456, prodName: 'CARNATION Novia', displayName: 'Novia', flowerName: '카네이션', counName: '콜롬비아', qty: 3, unit: '박스' },
]);
assert.equal(aggregates.length, 1);
assert.equal(aggregates[0].qty, 13, '같은 품목·단위는 화면 합산수량으로 묶어야 한다');
assert.deepEqual(aggregates[0].sourceRows, [4, 8]);
assert.equal(findImportMixedUnitProducts(aggregates).length, 0);
assert.equal(findImportMixedUnitProducts([
  ...aggregates,
  { ...aggregates[0], unit: '단' },
]).length, 1, '같은 품목에 서로 다른 단위가 있으면 등록 전 차단 표시');

const sourceOrdered = buildImportMatchAggregates([
  { rowNo: 20, inputName: '가나다', prodKey: 20, displayName: '가나다', flowerName: '가', qty: 1, unit: '단' },
  { rowNo: 4, inputName: '하늘', prodKey: 4, displayName: '하늘', flowerName: '하', qty: 1, unit: '단' },
  { rowNo: 10, inputName: '노랑', prodKey: 10, displayName: '노랑', flowerName: '나', qty: 1, unit: '단' },
]);
assert.deepEqual(sourceOrdered.map(row => row.prodKey), [4, 10, 20], '합산표는 품명 정렬이 아니라 Excel 첫 원본 행 순서를 따라야 한다');
const registerOrdered = mergeRegisterItems([
  { rowNo: 20, prodKey: 20, prodName: '가나다', qty: 1, unit: '단' },
  { rowNo: 4, prodKey: 4, prodName: '하늘', qty: 1, unit: '단' },
  { rowNo: 10, prodKey: 10, prodName: '노랑', qty: 1, unit: '단' },
]);
assert.deepEqual(registerOrdered.map(row => row.prodKey), [4, 10, 20], '주문등록 요청도 Excel 원본 행 순서를 따라야 한다');
assert.deepEqual(
  sortImportRowsByProductOrder([{ prodKey: 10 }, { prodKey: 99 }, { prodKey: 4 }], registerOrdered).map(row => row.prodKey),
  [4, 10, 99],
  '등록 결과는 Excel에 있는 품목을 원본 순서로 먼저 표시하고 파일 밖 기존 품목은 뒤에 유지해야 한다',
);

const inlineRows = buildImportInlineMatchRows([
  {
    inputName: '프리덤', prodKey: 101, displayName: 'ROSE / Freedom 50cm', qty: 30, unit: '단',
    sourceDetails: [{ rowNo: 4, qty: 20 }, { rowNo: 5, qty: 10 }],
  },
  { rowNo: 8, inputName: '미매칭', prodKey: null, qty: 2, unit: '박스' },
]);
assert.deepEqual(inlineRows.map(row => row.rowNo), [4, 5, 8]);
assert.equal(inlineRows[0].matches[0].isPrimary, true, '합산 품목의 첫 원본 행에서 최종수량을 편집해야 한다');
assert.equal(inlineRows[0].matches[0].sourceCount, 2);
assert.equal(inlineRows[1].matches[0].isPrimary, false, '후속 원본 행은 같은 합산 품목에 포함된 행임을 구분해야 한다');
assert.equal(inlineRows[1].matches[0].sourceQty, 10, '원본 행별 수량은 합산 최종수량과 별도로 보존해 표시해야 한다');
assert.equal(inlineRows[2].matches[0].itemIndex, 1, '미매칭 행도 원본 시트 옆에서 바로 수정할 수 있어야 한다');

assert.equal(findOrderImportMatchInsertIndex({
  headerRow: 3,
  rows: [{ rowNo: 3, cells: ['품명', '컬러', '발주수량', '출고수량', '단가', '비고'] }],
}), 3, 'ERP 매칭 셀은 발주수량 바로 뒤에 삽입해야 한다');
assert.equal(findOrderImportMatchInsertIndex({
  headerRow: 1,
  rows: [{ rowNo: 1, cells: ['품명', '주문 수량', '단가'] }],
}), 2, '발주수량 명칭이 없는 양식은 주문수량 바로 뒤에 삽입해야 한다');
assert.equal(findOrderImportMatchInsertIndex({
  headerRow: 1,
  rows: [{ rowNo: 1, cells: ['품명', '컬러', '비고'] }],
}), 3, '수량 헤더가 없는 예외 양식만 원본 열 끝에 표시해야 한다');

console.log('order import register helpers passed');
