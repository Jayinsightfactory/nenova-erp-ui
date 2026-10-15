import { mappingStoreFixture } from './helpers/mappingStoreFixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-rematch-'));
try {
  fs.mkdirSync(path.join(dir, 'data'));
  process.chdir(dir);
  const { reapplyImportSavedMappings } = await import('../lib/orderImportRematch.js');
  const fixture = mappingStoreFixture();
  const store = fixture.scoped;
  const products = [
    { ProdKey: 1, ProdName: 'HYDRANGEA WHITE', FlowerName: '수국', CounName: '콜롬비아' },
    { ProdKey: 2, ProdName: 'CARNATION WHITE', FlowerName: '카네이션', CounName: '콜롬비아' },
  ];
  const source = [
    { inputName: '화이트', detailLabel: '수국', prodKey: 2, qty: 17, unit: '송이', orderYear: 2025 },
    { inputName: '화이트', detailLabel: '카네이션', prodKey: null, qty: 3, unit: '단', orderYear: 2026 },
    { inputName: '화이트', detailLabel: '수국', prodKey: null, qty: 0, unit: '박스', skip: true },
  ];
  const context = { allProducts: products, savedMappings: {
    '수국 화이트': { prodKey: 1, manual: true },
    '카네이션 화이트': { prodKey: 2, manual: true },
  }, prodUnitMap: {}, unitCatalog: {} };
  const result = reapplyImportSavedMappings(source, context);
  assert.equal(result.restoredCount, 2);
  assert.deepEqual(result.items.map(x => [x.qty, x.unit, x.orderYear, x.skip]), source.map(x => [x.qty, x.unit, x.orderYear, x.skip]));
  assert.equal(result.items[0].matchName, '수국 화이트');
  assert.equal(result.items[0].prodKey, 1);
  assert.equal(result.items[2].prodKey, null);
  assert.equal(reapplyImportSavedMappings(source, { ...context, savedMappings: { '수국 화이트': { prodKey: 1, auto: true } } }).restoredCount, 0);
  assert.equal((await store.saveCustomerProductMapping(680, '수국 화이트', { prodKey: 1, manual: true }, { actor: 'first' })).saved, true);
  assert.equal((await store.saveCustomerProductMapping(680, '수국 화이트', { prodKey: 2, manual: false })).saved, false);
  assert.equal((await store.saveCustomerProductMapping(680, '수국 화이트', { prodKey: 2, manual: true }, { actor: 'second' })).saved, true);
  const saved = (await store.loadCustomerProductMappings(true))['680'];
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].before.prodKey, 1);
  assert.equal(saved.history[1].actor, 'second');
  assert.deepEqual((await store.getCustomerProductMappings(999, true)), {});
  (await store.deleteCustomerProductMapping(680, '수국 화이트'));
  assert.equal((await store.loadCustomerProductMappings(true))['680'].history.at(-1).after, null);
} finally {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('order import rematch tests passed');
