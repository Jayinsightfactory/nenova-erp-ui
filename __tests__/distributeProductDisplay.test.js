import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distributeProductName, distributePreviousStock, distributePreviousStockTotal } from '../lib/distributeProductDisplay.js';

const name = (ProdName, flower) => distributeProductName({ ProdName }, flower);
assert.equal(name('CARNATION Pastel Crimea', '카네이션'), 'Pastel Crimea');
assert.equal(name('CARNATION Pastel Crimea', ''), 'CARNATION Pastel Crimea');
assert.equal(name('CARNATION Pastel Crimea', '수국'), 'CARNATION Pastel Crimea');
assert.equal(name('MiniCarnation Athena', '카네이션'), 'MiniCarnation Athena');
assert.equal(name('Spray Carnation Caja', '카네이션'), 'Spray Carnation Caja');
assert.equal(name('CARNATION Rose Pink', '카네이션'), 'Rose Pink');
assert.equal(name('ROSE / Mondial', '장미'), 'Mondial');
assert.equal(name('Rosemary', '장미'), 'Rosemary');
assert.equal(name('CARNATION', '카네이션'), 'CARNATION');
assert.equal(name('카네이션 / 파스텔 크리미아', '카네이션'), '파스텔 크리미아');
assert.equal(distributeProductName({ DisplayName: '별도 한글명', ProdName: 'CARNATION test' }, '카네이션'), '별도 한글명');

for (const [year, previous] of [[2025, 7], [2026, 2]]) {
  const row = Object.freeze({ OrderYear: year, OrderWeek: '41-01', ProdKey: 345, _exeParity: true, prevStock: previous, inQty: 1 });
  assert.equal(distributePreviousStock(row), previous); // Never subtract the current receipt.
  assert.equal(row.inQty, 1);
}
assert.equal(distributePreviousStock({ _exeParity: true, prevStock: 0 }), 0);
assert.equal(distributePreviousStock({ _exeParity: true, prevStock: -1.2 }), -1.2);
for (const prevStock of [undefined, null, '', 'invalid']) assert.equal(distributePreviousStock({ _exeParity: true, prevStock }), null);
assert.equal(distributePreviousStock({ prevStock: 999, inQty: 5 }), null); // Current legacy snapshot is not carryover.
assert.equal(distributePreviousStockTotal([{ _exeParity: true, prevStock: 2 }, { _exeParity: true, prevStock: 0 }]), 2);
assert.equal(distributePreviousStockTotal([{ _exeParity: true, prevStock: 2 }, { prevStock: 999 }]), null);
const source = fs.readFileSync('pages/shipment/distribute.js', 'utf8');
assert.match(source, /minmax\(360px, 34%\) minmax\(0, 1fr\)/);
assert.match(source, /whiteSpace:'normal',overflowWrap:'anywhere'/);
assert.match(source, /data-product-select/);
assert.match(source, /ArrowDown/);
assert.match(source, /distributePreviousStockTotal\(filteredProds\)/);
assert.doesNotMatch(source, /\(p\.prevStock\|\|0\)-\(p\.inQty\|\|0\)/);
assert.match(source, /const remain = \(inQty\|\|0\) - totalOutInput/); // Existing input calculation not changed.
console.log('Distribution display: scoped prefix, original names, carryover source, zero/unknown/negative and separate-year fixtures passed');
