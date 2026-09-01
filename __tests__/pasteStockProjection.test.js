import assert from 'node:assert/strict';
import { resolveStockProjectionIdentity, summarizeStockProjection } from '../lib/pasteStockProjection.js';

const normalize = (value) => String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const aliases = new Map([
  [normalize('레몬잎'), { prodKey: 1718, names: ['SALAL TIPS'] }],
  [normalize('SALAL TIPS'), { prodKey: 1718, names: ['SALAL TIPS'] }],
  [normalize('다른 레몬잎'), { prodKey: 9999, names: ['OTHER SALAL'] }],
]);

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

console.log('paste stock projection tests passed');
