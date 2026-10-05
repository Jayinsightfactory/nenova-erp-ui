import assert from 'node:assert/strict';
import { chooseStockProductCandidate, formatStockDelta, formatStockVector, parseBaseStockQuantityLine, resolveStockProjectionIdentity, summarizeStockProjection } from '../lib/pasteStockProjection.js';

const normalize = (value) => String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const aliases = new Map([
  [normalize('레몬잎'), { prodKey: 1718, names: ['SALAL TIPS'] }],
  [normalize('SALAL TIPS'), { prodKey: 1718, names: ['SALAL TIPS'] }],
  [normalize('다른 레몬잎'), { prodKey: 9999, names: ['OTHER SALAL'] }],
]);

assert.deepEqual(parseBaseStockQuantityLine('오션송 10단 (티바)'), {
  name: '오션송', qty: 10, unit: '단',
}, '괄호 메모가 붙은 단위 수량도 기초재고에서 누락되면 안 된다.');
assert.deepEqual(parseBaseStockQuantityLine('나디야 1 (37-2 잔량)'), {
  name: '나디야', qty: 1, unit: '',
}, '과거 차수 참고 메모 뒤의 재고 수량을 읽어야 한다.');
assert.deepEqual(parseBaseStockQuantityLine('블루 1+15스팀'), {
  name: '블루', qty: 1, boxQty: 1, detailQty: 15, detailUnit: '스팀', unit: '박스',
}, '혼합 재고는 박스와 스팀 수량을 모두 보존해야 한다.');
const ambiguousProducts = [{ ProdKey: 1 }, { ProdKey: 2 }];
assert.deepEqual(
  chooseStockProductCandidate(ambiguousProducts.map((prod, index) => ({ prod, score: index === 0 ? 90 : 55 })), () => true),
  { prod: null, matchStatus: 'ambiguous', candidates: ambiguousProducts },
  '점수 차이가 있어도 실제 후보가 복수이면 자동확정하지 않고 선택 대상으로 남긴다.',
);

assert.equal(resolveStockProjectionIdentity('레몬잎', aliases, normalize).key, 'prod:1718');
assert.equal(resolveStockProjectionIdentity('SALAL TIPS', aliases, normalize).key, 'prod:1718');
assert.notEqual(
  resolveStockProjectionIdentity('레몬잎', aliases, normalize).key,
  resolveStockProjectionIdentity('다른 레몬잎', aliases, normalize).key,
  '이름이 비슷해도 다른 ProdKey는 합치면 안 된다.',
);

const summary = summarizeStockProjection([
  {
    identityKey: 'prod:1718',
    productName: '레몬잎',
    start: 70,
    unit: '박스',
    changes: [{ delta: 2, kind: 'add' }],
    warnings: [],
    match: { prodKey: 1718, names: ['SALAL TIPS'] },
  },
]);
assert.deepEqual(
  { start: summary[0].start, added: summary[0].added, cancelled: summary[0].cancelled, expected: summary[0].expected },
  { start: 70, added: 2, cancelled: 0, expected: 68 },
  'SALAL TIPS 기초재고 70과 레몬잎 추가 2는 같은 품목으로 연결되어 68이 되어야 한다.',
);

const cancelSummary = summarizeStockProjection([
  {
    identityKey: 'prod:1718',
    productName: '레몬잎',
    start: 70,
    unit: '박스',
    changes: [{ delta: -3, kind: 'cancel' }],
    warnings: [],
    match: { prodKey: 1718, names: ['SALAL TIPS'] },
  },
]);
assert.equal(cancelSummary[0].expected, 73, '취소는 기초재고에 되돌아와 예상잔량을 늘려야 한다.');

const mixedUnitSummary = summarizeStockProjection([
  {
    identityKey: 'prod:44',
    productName: '블루',
    start: 1,
    baseStart: 1,
    baseDetailQty: 15,
    baseUnit: '박스',
    unit: '박스',
    detailUnit: '스팀',
    changes: [{ delta: -1, unit: '박스', kind: 'cancel' }],
    warnings: [],
    match: { prodKey: 44, names: ['Hydrangea Blue'] },
  },
  {
    identityKey: 'prod:44',
    productName: '블루',
    start: 0,
    baseStart: 1,
    baseDetailQty: 15,
    baseUnit: '박스',
    unit: '스팀',
    detailUnit: '스팀',
    changes: [{ delta: 2, unit: '스팀', kind: 'add' }],
    warnings: [],
    match: { prodKey: 44, names: ['Hydrangea Blue'] },
  },
])[0];
assert.deepEqual(
  {
    start: mixedUnitSummary.start,
    startDetail: mixedUnitSummary.startDetail,
    cancelled: mixedUnitSummary.cancelled,
    addedDetail: mixedUnitSummary.addedDetail,
    expected: mixedUnitSummary.expected,
    expectedDetail: mixedUnitSummary.expectedDetail,
  },
  { start: 1, startDetail: 15, cancelled: 1, addedDetail: 2, expected: 2, expectedDetail: 13 },
  '박스 취소와 스팀 추가는 각 단위 축에서 독립 계산되어야 한다.',
);
assert.equal(mixedUnitSummary.detailUnit, '스팀', '정규화 후에도 사용자가 입력한 세부 단위 표기는 유지한다.');
assert.equal(formatStockVector(mixedUnitSummary.expected, mixedUnitSummary.expectedDetail, '박스', '송이'), '2박스 + 13송이');
assert.equal(formatStockDelta(1, 2, '박스', '송이', '-'), '-1박스 -2송이');

const unresolved = summarizeStockProjection([{
  identityKey: 'name:염색연그린',
  productName: '염색연그린',
  start: 5,
  baseStart: 5,
  unit: '박스',
  changes: [{ delta: 1, unit: '박스', kind: 'add' }],
  warnings: ['품목 후보 여러 개'],
  match: { status: 'ambiguous', names: ['후보 A', '후보 B'] },
}])[0];
assert.equal(unresolved.unresolved, true, '복수 후보는 품목 선택 전까지 계산결과로 확정 표시하지 않는다.');

const allBaseRows = summarizeStockProjection([
  { identityKey: 'prod:1', productName: 'DB 변경명 A', baseInputName: '카톡 기초명 A', start: 10, baseStart: 10, unit: '단', changes: [{ delta: 2, unit: '단' }], warnings: [], match: { prodKey: 1, names: ['DB 변경명 A'] } },
  { identityKey: 'prod:2', productName: 'DB 변경명 B', baseInputName: '카톡 기초명 B', start: 7, baseStart: 7, unit: '단', changes: [], warnings: [], match: { prodKey: 2, names: ['DB 변경명 B'] } },
]);
assert.equal(allBaseRows.length, 2, '변경이 없는 항목도 기초재고 전체 목록에서 빠지면 안 된다.');
assert.deepEqual(allBaseRows.map(row => row.productName), ['카톡 기초명 A', '카톡 기초명 B'], '표시명은 DB 품목명이 아니라 기초재고 원문 텍스트를 사용해야 한다.');
assert.equal(allBaseRows[1].expected, 7, '변경 없는 기초재고 항목은 원래 잔량을 그대로 표시해야 한다.');

console.log('paste stock projection tests passed');
