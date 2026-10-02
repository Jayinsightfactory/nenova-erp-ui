import assert from 'node:assert/strict';
import { resolveManualMappingOverride } from '../lib/pasteManualMappingOverride.js';

const rose50 = { ProdKey: 1255, ProdName: 'ROSE / Pink Mondial 50cm', FlowerName: '장미', CounName: '콜롬비아', isDeleted: 0 };
const rose40 = { ...rose50, ProdKey: 1437, ProdName: 'ROSE / Pink Mondial 40cm' };
const hydrangea = { ProdKey: 99, ProdName: 'HYDRANGEA White', FlowerName: '수국', CounName: '콜롬비아', isDeleted: 0 };
const mix = { ProdKey: 100, ProdName: 'MIX BOX', FlowerName: '장미', CounName: '콜롬비아', isDeleted: 0 };
const freight = { ProdKey: 101, ProdName: '항공운송료', FlowerName: '장미', CounName: '콜롬비아', isDeleted: 0 };
const products = [rose50, rose40, hydrangea, mix, freight];
const manual = prodKey => ({ prodKey, manual: true, prodName: 'stale cache name' });
const resolve = (input, mappings, active = products, context = input) => resolveManualMappingOverride(input, mappings, active, context);

// Both years of the same week receive the same alias decision without modifying
// any source quantity, unit, action, year or week.
for (const year of [2025, 2026]) {
  const row = Object.freeze({ inputName: '콜롬비아 장미 Pink Mondial 50cm', qty: 12, unit: '단', action: '취소', year, week: '36-02' });
  const saved = { '콜롬비아 장미 pink mondial 50cm': manual(1255) };
  const result = resolve(row.inputName, saved);
  assert.equal(result?.product, rose50);
  assert.deepEqual(result?.mapping, { key: '콜롬비아 장미 pink mondial 50cm', value: saved['콜롬비아 장미 pink mondial 50cm'] });
  assert.deepEqual(row, { inputName: '콜롬비아 장미 Pink Mondial 50cm', qty: 12, unit: '단', action: '취소', year, week: '36-02' });
}

assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': { prodKey: 1255 } }), null, 'legacy mapping is not explicit manual');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': { ...manual(1255), manual: false } }), null);
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': { ...manual(1255), auto: true, manual: false } }), null, 'auto fallback blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '장미 pink mondial': manual(1255) }), null, 'fuzzy shorter alias blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': { ...manual(1255), auto: true } }), null, 'contradictory auto/manual mapping blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아장미pinkmondial50cm': manual(1255) }), null, 'compact lookup blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': manual(9999) }), null, 'cache-only product blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': manual(1255) }, [{ ...rose50, isDeleted: 1 }]), null, 'deleted product blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', { '콜롬비아 장미 pink mondial 50cm': manual(1437) }), null, 'cm conflict blocked');
assert.equal(resolve('중국 장미 Pink Mondial 50cm', { '중국 장미 pink mondial 50cm': manual(1255) }), null, 'country conflict blocked');
const shortAlias = { 'pink mondial': manual(1255) };
assert.equal(resolve('Pink Mondial', shortAlias, products, '콜롬비아 장미 Pink Mondial 50cm')?.product, rose50, 'exact short alias allowed with compatible full context');
assert.equal(resolve('Pink Mondial', shortAlias, products, '중국 장미 Pink Mondial 50cm'), null, 'Chinese header context blocks Colombian alias');
assert.equal(resolve('Pink Mondial', shortAlias, products, '콜롬비아 수국 Pink Mondial 50cm'), null, 'full context flower family blocks alias');
assert.equal(resolve('Pink Mondial', shortAlias, products, '콜롬비아 장미 Pink Mondial 40cm'), null, 'full context cm blocks alias');
assert.equal(resolve('Pink Mondial', { 'pink mondial': manual(100) }, products, '콜롬비아 장미 Pink Mondial 50cm'), null, 'full context mix guard blocks alias');
assert.equal(resolve('Pink Mondial', { 'pink mondial': manual(101) }, products, '콜롬비아 장미 Pink Mondial 50cm'), null, 'full context freight guard blocks alias');
assert.equal(resolve('콜롬비아 장미 White', { '콜롬비아 장미 white': manual(99) }), null, 'flower family conflict blocked');
assert.equal(resolve('콜롬비아 장미 White', { '콜롬비아 장미 white': manual(100) }), null, 'mix box conflict blocked');
assert.equal(resolve('콜롬비아 장미 White', { '콜롬비아 장미 white': manual(101) }), null, 'freight conflict blocked');
assert.equal(resolve('콜롬비아 장미 Pink Mondial 50cm', {
  '콜롬비아 장미 pink mondial 50cm': manual(1255),
  '콜롬비아 장미 Pink Mondial 50cm ': manual(1437),
}), null, 'duplicate normalized aliases blocked');

console.log('paste manual override: exact persisted manual alias, active key, ERP-context and mix/freight guards passed');
