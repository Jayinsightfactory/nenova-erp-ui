import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distributeProductName, distributePreviousStock, distributePreviousStockTotal } from '../lib/distributeProductDisplay.js';

const name = (ProdName, flower) => distributeProductName({ ProdName }, flower);
assert.equal(name('CARNATION Pastel Crimea', '카네이션'), 'Pastel Crimea');
// Native legacy spelling is display-only: retain the exact original product/order key.
for(const year of [2025,2026]){
 const row=Object.freeze({OrderYear:year,OrderWeek:'46-01',ProdKey:3513,ProdName:'CARANATION Vintage Honey',OutQuantity:29,Amount:100,Vat:10});
 const before=JSON.stringify(row);assert.equal(distributeProductName(row,'카네이션'),'Vintage Honey');assert.equal(JSON.stringify(row),before);
 assert.equal(distributeProductName(row,'장미'),'CARANATION Vintage Honey');
}
assert.equal(name('CARANATION','카네이션'),'CARANATION');
assert.equal(name('CARANATIONX Honey','카네이션'),'CARANATIONX Honey');

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
// 왼쪽 품목 목록은 품목명만 (세부 수치는 선택 시 오른쪽) → 폭 축소
assert.match(source, /minmax\(210px, 20%\) minmax\(0, 1fr\)/);
const tree = fs.readFileSync('components/shipment/DistributionProductTree.js','utf8');
assert.match(tree, /whiteSpace:'normal',overflowWrap:'anywhere'/);
assert.match(tree, /data-product-select/);
assert.match(tree, /ArrowDown/);
assert.match(source, /\['전차수 재고',previousStock,/); // 전차수 재고는 상단 카드로
assert.doesNotMatch(source, /\(p\.prevStock\|\|0\)-\(p\.inQty\|\|0\)/);
assert.match(source, /const remain = \(inQty\|\|0\) - totalOutInput/); // Existing input calculation not changed.
console.log('Distribution display: scoped prefix, original names, carryover source, zero/unknown/negative and separate-year fixtures passed');
