import { mappingStoreFixture } from './helpers/mappingStoreFixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-import-reuse-'));

const products = [
  { ProdKey: 101, ProdName: 'HYDRANGEA WHITE', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스' },
  { ProdKey: 102, ProdName: 'CARNATION WHITE', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스' },
  { ProdKey: 103, ProdName: 'HYDRANGEA WHITE SPECIAL', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스' },
  { ProdKey: 104, ProdName: 'ROSE PROUD 50cm', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
  { ProdKey: 105, ProdName: 'ROSE PROUD 50cm', FlowerName: '장미', CounName: '중국', OutUnit: '단' },
  { ProdKey: 106, ProdName: 'ROSE PROUD 60cm', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
  { ProdKey: 107, ProdName: 'ROSE MIX BOX', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '박스' },
  { ProdKey: 108, ProdName: '항공 운송료', FlowerName: '', CounName: '', OutUnit: '박스' },
];
const productByKey = new Map(products.map((product) => [product.ProdKey, product]));

try {
  fs.mkdirSync(path.join(tempDir, 'data'));
  process.chdir(tempDir);
  const fixture = mappingStoreFixture();
  const store = fixture.scoped;
  const { matchImportRows } = await import('../lib/orderImportMatch.js');
  const row = (inputName, matchName, category = '') => ({ inputName, matchName, category, qty: 1, unit: '박스' });
  const match = (source, mappings) => matchImportRows([source], {
    allProducts: products,
    productByKey,
    savedMappings: mappings,
    prodUnitMap: {},
    unitCatalog: {},
  })[0];
  const save = async (custKey, key, prodKey) => assert.equal((await store.saveCustomerProductMapping(
    custKey, key,
    { prodKey, manual: true, prodName: productByKey.get(prodKey).ProdName },
  )).saved, true);

  await save(11, '수국 화이트', 103);
  await save(11, '카네이션 화이트', 102);
  const global = {
    '화이트': { prodKey: 102, manual: true },
    '수국 화이트 스페셜': { prodKey: 101, auto: true },
  };
  const saved = (await store.mergeCustomerProductMappings(global, 11, true));
  const hydrangea = match(row('화이트', '수국 화이트', '수국'), saved);
  const carnation = match(row('화이트', '카네이션 화이트', '카네이션'), saved);
  assert.equal(hydrangea.prodKey, 103, '수국 수동 선택은 자동/유사 캐시보다 우선한다');
  assert.equal(carnation.prodKey, 102, '동일한 칼라명이라도 카네이션의 저장 선택을 재사용한다');
  assert.equal(hydrangea.matchName, '수국 화이트', '매칭 결과가 저장에 필요한 전체 문맥을 보존한다');
  assert.equal(hydrangea.category, '수국');
  assert.equal(hydrangea.mappingScope, 'customer');
  assert.equal(hydrangea.mappingManual, true);

  const reloaded = (await store.mergeCustomerProductMappings(global, 11, true));
  assert.equal(match(row('화이트', '수국 화이트'), reloaded).prodKey, 103, '새 요청에서 저장소를 다시 읽어도 선택이 유지된다');
  assert.notEqual(match(row('화이트', '수국 화이트'), (await store.mergeCustomerProductMappings(global, 22, true))).prodKey, 103,
    '다른 업체가 업체별 수동 선택을 가져오지 않는다');

  const legacy = { '화이트': { prodKey: 102, manual: true } };
  assert.equal(match(row('화이트', '수국 화이트'), legacy).fromMapping, false,
    '화종이 다른 단일 칼라 별칭을 잘못 재사용하지 않는다');
  assert.equal(match(row('화이트', '카네이션 화이트'), legacy).prodKey, 102,
    '문맥이 맞는 이전 단일 칼라 수동 별칭은 계속 사용한다');

  const roseAliases = { 'Proud': { prodKey: 104, manual: true } };
  assert.equal(match(row('Proud', '중국 장미 Proud 50cm'), roseAliases).fromMapping, false,
    '국가가 다른 단일 별칭은 재사용하지 않는다');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 60cm'), roseAliases).fromMapping, false,
    '길이가 다른 단일 별칭은 재사용하지 않는다');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 50cm'), { Proud: { prodKey: 107, manual: true } }).fromMapping, false,
    '믹스박스 단일 별칭을 일반 장미 주문에 재사용하지 않는다');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 50cm'), { Proud: { prodKey: 108, manual: true } }).fromMapping, false,
    '운송료 단일 별칭을 일반 꽃 주문에 재사용하지 않는다');

  await save(11, '콜롬비아 장미 Proud 50cm', 106);
  const substituted = match(row('Proud', '콜롬비아 장미 Proud 50cm'),
    (await store.mergeCustomerProductMappings(roseAliases, 11, true)));
  assert.equal(substituted.prodKey, 106,
    '업체가 전체 문맥에 저장한 정확한 수동 대체품은 50cm 입력에도 60cm 선택을 유지한다');
  assert.equal(substituted.fromMapping, true);
  await save(11, '콜롬비아 장미 Proud 60cm', 104);
  const lengthScoped = (await store.mergeCustomerProductMappings({}, 11, true));
  assert.equal(match(row('Proud', '콜롬비아장미Proud50cm'), lengthScoped).prodKey, 106,
    '공백만 다른 원문에서도 저장한 대체품을 유지한다');
  assert.equal(lengthScoped['콜롬비아 장미 proud 50cm'].prodKey, 106);
  assert.equal(lengthScoped['콜롬비아 장미 proud 60cm'].prodKey, 104,
    '50cm와 60cm는 별도 저장 키로 공존한다');
  assert.equal(lengthScoped['콜롬비아 장미 proud 50cm'].sourceMatchName, '콜롬비아 장미 Proud 50cm');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 50cm'), lengthScoped).prodKey, 106,
    '새 요청의 50cm 선택은 60cm 저장 후에도 유지된다');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 60cm'), lengthScoped).prodKey, 104,
    '새 요청의 60cm 선택은 자체 저장값을 사용한다');
  await save(33, '콜롬비아 장미 Proud 50cm', 106);
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 60cm'),
    (await store.mergeCustomerProductMappings({}, 33, true))).fromMapping, false,
  '50cm 새 저장값이 60cm 유사 매칭으로 흘러가지 않는다');
  await save(44, '수국 화이트', 102);
  assert.equal(match(row('수국 화이트', '수국 화이트'),
    (await store.mergeCustomerProductMappings({}, 44, true))).prodKey, 102,
  '문맥 분리 열이 없는 행도 정확한 업체 수동 선택을 유지한다');
  assert.equal((await store.deleteCustomerProductMapping(33, '콜롬비아 장미 (Proud) 50cm')).deleted, true,
    '신규 키는 괄호·공백 정규화로 삭제한다');
  const storeFile = path.join(tempDir, 'data', 'order-import-customer-product-mappings.runtime.json');
  const persisted = fixture.documents['customer-product'];
  persisted['55'] = { custKey: 55, mappings: { '장미 proud': { prodKey: 104, manual: true } } };
  fixture.documents['customer-product'] = persisted;
  assert.equal((await store.deleteCustomerProductMapping(55, '장미 Proud 50cm')).deleted, true,
    '이전 저장 키도 삭제할 수 있다');
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 50cm'), {
    '콜롬비아 장미 Proud 50cm': { prodKey: 106, manual: true },
  }).fromMapping, false, '공용 매핑은 같은 길이 대체를 무조건 적용하지 않는다');
  await save(22, 'Proud', 106);
  assert.equal(match(row('Proud', '콜롬비아 장미 Proud 50cm'),
    (await store.mergeCustomerProductMappings({}, 22, true))).fromMapping, false,
  '업체 수동값이어도 짧은 별칭은 전체 문맥 예외를 적용하지 않는다');

  const deleted = { '수국 화이트': { prodKey: 999, manual: true } };
  assert.equal(match(row('화이트', '수국 화이트'), deleted).fromMapping, false,
    '삭제된 품목 키는 저장 매핑으로 확정하지 않는다');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('order import mapping reuse tests passed');
