import assert from 'node:assert/strict';
import {
  convertQtyToOutUnit,
  mergeBaselineCandidates,
  buildCompareRows,
  buildUpdateCostPayload,
  roundQty,
} from '../lib/orderImportCompareLogic.js';

// 1. convertQtyToOutUnit tests
assert.equal(
  convertQtyToOutUnit({ qty: 5, unit: '박스', outUnit: '박스', bunchOf1Box: 10, steamOf1Box: 100 }),
  5,
  '같은 단위(박스->박스)는 그대로 반환',
);
assert.equal(
  convertQtyToOutUnit({ qty: 2, unit: '박스', outUnit: '단', bunchOf1Box: 10, steamOf1Box: 100 }),
  20,
  '박스->단 환산 (2 * 10 = 20)',
);
assert.equal(
  convertQtyToOutUnit({ qty: 3, unit: '박스', outUnit: '송이', bunchOf1Box: 10, steamOf1Box: 50 }),
  150,
  '박스->송이 환산 (3 * 50 = 150)',
);
assert.equal(
  convertQtyToOutUnit({ qty: 25, unit: '단', outUnit: '박스', bunchOf1Box: 10, steamOf1Box: 100 }),
  2.5,
  '단->박스 환산 (25 / 10 = 2.5)',
);
assert.equal(
  convertQtyToOutUnit({ qty: 20, unit: '단', outUnit: '송이', bunchOf1Box: 10, steamOf1Box: 100 }),
  200,
  '단->송이 환산 ((20 / 10) * 100 = 200)',
);
assert.equal(
  convertQtyToOutUnit({ qty: 50, unit: '송이', outUnit: '단', bunchOf1Box: 10, steamOf1Box: 100 }),
  5,
  '송이->단 환산 ((50 / 100) * 10 = 5)',
);
assert.equal(
  convertQtyToOutUnit({ qty: 7, unit: '박스', outUnit: '단', bunchOf1Box: 0, steamOf1Box: 0 }),
  7,
  '환산 계수 누락/0이면 원본 수량 반환',
);

// 2. Single upload comparison (SAME, INCREASED, DECREASED, UNALLOCATED, ADDED) + excelHeaders preservation
const singleUpload = [
  {
    id: 'upload:1',
    sourceKind: 'UPLOAD',
    dateKey: '2026-11-24',
    timestamp: '2026-11-24T09:00:00',
    label: '엑셀 업로드 · 47차_라움.xlsx',
    sheetPreview: {
      headerRow: 2,
      rows: [
        { rowNo: 1, cells: ['라움 47차 발주서'] },
        { rowNo: 2, cells: ['품명', '칼라', '발주수량', '단가', '비고'] },
        { rowNo: 3, cells: ['장미', '몬디알', '10', '15000', '1차'] },
        { rowNo: 4, cells: ['장미', '프리덤', '5', '12000', ''] },
        { rowNo: 5, cells: ['카네이션', '노비아', '8', '10000', '긴급'] },
        { rowNo: 6, cells: ['수국', '화이트', '4', '20000', ''] },
      ],
    },
    items: [
      { rowNo: 3, inputName: '몬디알', colorOrDetail: '화이트', prodKey: 101, prodName: 'ROSE Mondial', unit: '박스', outUnit: '박스', qty: 10, unitPrice: 15000, note: '1차' },
      { rowNo: 4, inputName: '프리덤', colorOrDetail: '레드', prodKey: 102, prodName: 'ROSE Freedom', unit: '박스', outUnit: '박스', qty: 5, unitPrice: 12000, note: '' },
      { rowNo: 5, inputName: '노비아', colorOrDetail: '핑크', prodKey: 103, prodName: 'CARNATION Novia', unit: '박스', outUnit: '박스', qty: 8, unitPrice: 10000, note: '긴급' },
      { rowNo: 6, inputName: '화이트 수국', colorOrDetail: '화이트', prodKey: 104, prodName: 'HYDRANGEA White', unit: '박스', outUnit: '박스', qty: 4, unitPrice: 20000, note: '' },
    ],
  },
];

const mergedSingle = mergeBaselineCandidates(singleUpload);
assert.equal(mergedSingle.isSingleUpload, true);
assert.deepEqual(mergedSingle.excelHeaders, ['품명', '칼라', '발주수량', '단가', '비고']);
assert.deepEqual(mergedSingle.items[0].rawCells, ['장미', '몬디알', '10', '15000', '1차']);

const shipItems = [
  { prodKey: 101, prodName: 'ROSE Mondial', outUnit: '박스', shipQty: 10 },
  { prodKey: 102, prodName: 'ROSE Freedom', outUnit: '박스', shipQty: 7 },
  { prodKey: 103, prodName: 'CARNATION Novia', outUnit: '박스', shipQty: 5 },
  { prodKey: 999, prodName: 'LILY Siberia', displayName: '시베리아 백합', outUnit: '박스', shipQty: 3 },
];

const cmp1 = buildCompareRows(mergedSingle, shipItems);
assert.deepEqual(
  cmp1.rows.map((r) => [r.prodKey, r.status, r.baselineQty, r.shipQty, r.diff]),
  [
    [101, 'SAME', 10, 10, 0],
    [102, 'INCREASED', 5, 7, 2],
    [103, 'DECREASED', 8, 5, -3],
    [104, 'UNALLOCATED', 4, 0, -4],
    [999, 'ADDED', 0, 3, 3],
  ],
);
assert.deepEqual(cmp1.summary, {
  baselineItemCount: 4,
  baselineTotalQty: 27,
  shipItemCount: 4,
  shipTotalQty: 25,
  changedCount: 4,
  sameCount: 1,
  increasedCount: 1,
  decreasedCount: 1,
  unallocatedCount: 1,
  addedCount: 1,
  netDiff: -2,
});

// 3. Single sheet duplicate prodKey rows merged (prevents shipQty double-counting)
const duplicateSheet = [
  {
    id: 'upload:2',
    sourceKind: 'UPLOAD',
    dateKey: '2026-11-25',
    timestamp: '2026-11-25T10:00:00',
    label: '중복행 테스트',
    sheetPreview: {
      headerRow: 1,
      rows: [
        { rowNo: 1, cells: ['품명', '수량'] },
        { rowNo: 2, cells: ['몬디알', '3'] },
        { rowNo: 5, cells: ['몬디알 추가', '2'] },
      ],
    },
    items: [
      { rowNo: 2, inputName: '몬디알', prodKey: 101, prodName: 'ROSE Mondial', unit: '박스', outUnit: '박스', qty: 3 },
      { rowNo: 5, inputName: '몬디알 추가', prodKey: 101, prodName: 'ROSE Mondial', unit: '박스', outUnit: '박스', qty: 2 },
    ],
  },
];
const mergedDup = mergeBaselineCandidates(duplicateSheet);
assert.equal(mergedDup.items.length, 1, '단일 시트 내 중복 prodKey는 1행으로 병합');
assert.equal(mergedDup.items[0].outQty, 5);
assert.deepEqual(mergedDup.items[0].rowNos, [2, 5]);
assert.equal(mergedDup.items[0].sources.length, 1);
const cmpDup = buildCompareRows(mergedDup, [{ prodKey: 101, outUnit: '박스', shipQty: 5 }]);
assert.equal(cmpDup.rows[0].status, 'SAME');
assert.equal(cmpDup.summary.shipTotalQty, 5, 'shipQty가 이중 계산되지 않아야 한다');

// 4. Multi-date chronological merge (out-of-order input sorted chronologically, earliest metadata preserved)
const multiCandidates = [
  {
    id: 'order-date:2026-11-26',
    sourceKind: 'ORDER_DATE',
    dateKey: '2026-11-26',
    timestamp: '2026-11-26T14:00:00',
    label: '직접 주문등록',
    items: [
      { rowNo: 1, inputName: 'ROSE Mondial', prodKey: 101, prodName: 'ROSE Mondial', unit: '박스', outUnit: '박스', qty: 4 },
      { rowNo: 2, inputName: '신규직접품목', prodKey: 202, prodName: 'TULIP White', unit: '단', outUnit: '단', qty: 6 },
    ],
  },
  {
    id: 'upload:10',
    sourceKind: 'UPLOAD',
    dateKey: '2026-11-24',
    timestamp: '2026-11-24T08:30:00',
    label: '최초 업로드',
    sheetPreview: { headerRow: 1, rows: [{ rowNo: 1, cells: ['품명', '수량'] }] },
    items: [
      { rowNo: 3, inputName: '몬디알(원본)', colorOrDetail: '화이트', prodKey: 101, prodName: 'ROSE Mondial', unit: '단', outUnit: '박스', bunchOf1Box: 10, qty: 20, unitPrice: 15000, note: '원본비고' },
    ],
  },
];
const mergedMulti = mergeBaselineCandidates(multiCandidates);
assert.equal(mergedMulti.isSingleUpload, false);
assert.equal(mergedMulti.excelHeaders, null);
assert.equal(mergedMulti.items.length, 2);
assert.equal(mergedMulti.items[0].prodKey, 101, '가장 이른 후보의 행 순서 유지');
assert.equal(mergedMulti.items[0].inputName, '몬디알(원본)', '가장 이른 후보 메타데이터 보존');
assert.equal(mergedMulti.items[0].note, '원본비고');
assert.equal(mergedMulti.items[0].outQty, 6, '20단(=2박스) + 4박스 = 6박스');
assert.equal(mergedMulti.items[0].unitMixed, true, '서로 다른 단위 병합 시 unitMixed=true');
assert.equal(mergedMulti.items[0].sources.length, 2);
assert.equal(mergedMulti.items[1].prodKey, 202, '후속 후보 품목은 뒤에 추가');

// 5. Empty input & null/0 prodKey fallback edge cases
const emptyCmp = buildCompareRows(mergeBaselineCandidates([]), []);
assert.deepEqual(emptyCmp.rows, []);
assert.equal(emptyCmp.summary.netDiff, 0);

const fallbackMerge = mergeBaselineCandidates([
  {
    id: 'upload:3',
    sourceKind: 'UPLOAD',
    dateKey: '2026-11-24',
    timestamp: '2026-11-24T09:00:00',
    label: 'A',
    items: [{ rowNo: 2, inputName: '장미 몬디알', prodKey: null, unit: '박스', qty: 3 }],
  },
  {
    id: 'upload:4',
    sourceKind: 'UPLOAD',
    dateKey: '2026-11-25',
    timestamp: '2026-11-25T09:00:00',
    label: 'B',
    items: [{ rowNo: 4, inputName: '장미  몬디알 ', prodKey: 0, unit: '박스', qty: 2 }],
  },
]);
assert.equal(fallbackMerge.items.length, 1, 'prodKey null/0은 정규화 inputName 기준으로 병합');
assert.equal(fallbackMerge.items[0].outQty, 5);
assert.equal(roundQty(0.1 + 0.2), 0.3);

// 6. buildUpdateCostPayload tests
const priceRowsSource = [
  {
    prodKey: 101,
    prodName: 'ROSE Mondial',
    displayName: '몬디알',
    shipQty: 10,
    shipCost: 15000,
    shipAmount: 150000,
    hasFixed: false,
    hasMixedShipCost: false,
    shipmentDetails: [
      { shipmentKey: 7001, sdetailKey: 9001, outQty: 10, estQty: 10, cost: 15000, amount: 150000, isFix: 0 },
    ],
  },
  {
    prodKey: 102,
    prodName: 'ROSE Freedom',
    displayName: '프리덤',
    shipQty: 8,
    shipCost: 12000,
    shipAmount: 96000,
    hasFixed: true,
    hasMixedShipCost: false,
    shipmentDetails: [
      { shipmentKey: 7001, sdetailKey: 9002, outQty: 5, estQty: 5, cost: 12000, amount: 60000, isFix: 0 },
      { shipmentKey: 7002, sdetailKey: 9003, outQty: 3, estQty: 3, cost: 12000, amount: 36000, isFix: 1 },
    ],
  },
  {
    prodKey: 103,
    prodName: 'CARNATION Novia',
    displayName: '노비아',
    shipQty: 4,
    shipCost: 10000,
    shipAmount: 42000,
    hasFixed: false,
    hasMixedShipCost: true,
    shipmentDetails: [
      { shipmentKey: 7001, sdetailKey: 9004, outQty: 2, estQty: 2, cost: 10000, amount: 20000, isFix: 0 },
      { shipmentKey: 7002, sdetailKey: 9005, outQty: 2, estQty: 2, cost: 11000, amount: 22000, isFix: 0 },
    ],
  },
];

// 6-1. Single row unit price edit -> { shipmentKey, sdetailKey, cost, expectedOldCost }
const p1 = buildUpdateCostPayload(priceRowsSource, { '101': '16,500' });
assert.deepEqual(p1, {
  items: [{ shipmentKey: 7001, sdetailKey: 9001, cost: 16500, expectedOldCost: 15000 }],
  editedRowCount: 1,
  detailRowCount: 1,
  hasFixedTarget: false,
  invalidRows: [],
});

// 6-2 & 6-3. Multi ShipmentDetail rows per ProdKey expanded & isFix === 1 sets hasFixedTarget: true
const p2 = buildUpdateCostPayload(priceRowsSource, { '102': '13000' });
assert.deepEqual(p2, {
  items: [
    { shipmentKey: 7001, sdetailKey: 9002, cost: 13000, expectedOldCost: 12000 },
    { shipmentKey: 7002, sdetailKey: 9003, cost: 13000, expectedOldCost: 12000 },
  ],
  editedRowCount: 1,
  detailRowCount: 2,
  hasFixedTarget: true,
  invalidRows: [],
});

// 6-4. Unchanged price (< 0.5) skipped unless hasMixedShipCost: true
const p3 = buildUpdateCostPayload(priceRowsSource, { '101': '15000.4', '103': '10000' });
assert.equal(p3.editedRowCount, 1, '동일 단가는 건너뛰고 hasMixedShipCost=true 품목만 포함');
assert.equal(p3.detailRowCount, 2);
assert.deepEqual(p3.items, [
  { shipmentKey: 7001, sdetailKey: 9004, cost: 10000, expectedOldCost: 10000 },
  { shipmentKey: 7002, sdetailKey: 9005, cost: 10000, expectedOldCost: 11000 },
]);

// 6-5. Negative / non-numeric inputs collected into invalidRows
const p4 = buildUpdateCostPayload(priceRowsSource, { '101': '-500', '102': 'abc', '103': '   ' });
assert.equal(p4.editedRowCount, 0);
assert.equal(p4.detailRowCount, 0);
assert.deepEqual(p4.invalidRows, [
  { prodKey: 101, prodName: '몬디알', rawValue: '-500' },
  { prodKey: 102, prodName: '프리덤', rawValue: 'abc' },
]);

console.log('order import compare tests passed');
