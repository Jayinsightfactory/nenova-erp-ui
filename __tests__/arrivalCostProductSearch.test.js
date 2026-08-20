import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findMappingProdKeysForQuery, isArrivalDisplayToken, buildArrivalCostProductMatch, bindArrivalCostProductMatch } from '../lib/arrivalCostProductSearch.js';

const mappings = {
  '문라이트': { prodKey: 11, prodName: 'CARNATION Moon Light', displayName: '카네이션 문라이트', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 수국 화이트': { prodKey: 22, prodName: 'Hydrangea White', displayName: '수국 화이트', flowerName: '수국', counName: '콜롬비아' },
  '레드나오미': { prodKey: 33, prodName: 'ROSE / Red Naomi', displayName: '장미 레드나오미', flowerName: '장미', counName: '네덜란드' },
};

assert.equal(isArrivalDisplayToken('29-1'), true, '차수는 표시 토큰이다.');
assert.equal(isArrivalDisplayToken('콜롬비아'), true, '국가는 표시 토큰이다.');
assert.equal(isArrivalDisplayToken('문라이트'), false);

assert.deepEqual(findMappingProdKeysForQuery('문라이트', mappings), [11]);
assert.deepEqual(findMappingProdKeysForQuery('수국 화이트', mappings), [22]);
assert.deepEqual(findMappingProdKeysForQuery('레드나오미', mappings), [33]);
assert.deepEqual(findMappingProdKeysForQuery('콜롬비아', mappings), [], '국가만 입력하면 품목 검색 키가 아니다.');
assert.deepEqual(findMappingProdKeysForQuery('29-01', mappings), [], '차수만 입력하면 품목 검색 키가 아니다.');

const match = buildArrivalCostProductMatch('문라이트', mappings);
assert.equal(match.useMappingKeys, true);
assert.deepEqual(match.prodKeys, [11]);

const params = {};
const bound = bindArrivalCostProductMatch(match, params, { sqlInt: 'Int', sqlNVarChar: 'NVarChar' });
assert.match(bound.sql, /l\.ProdKey IN \(@mapPk0\)/);
assert.equal(params.mapPk0.value, 11);
assert.match(bound.sql, /l\.ProductNameRaw LIKE @product/, '엑셀 원문명 fallback도 유지한다.');

const page = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../lib/arrivalCost.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../pages/api/products/search.js', import.meta.url), 'utf8');
assert.match(page, /매칭데이터/, '검색 안내가 매칭데이터 기준이어야 한다.');
assert.doesNotMatch(page, /<label>국가 /, '국가는 검색 조건이 아니라 표시 컬럼이다.');
assert.match(page, /applySearch\(\)/, '품목 검색 Enter는 조회를 적용해야 한다.');
assert.match(lib, /buildArrivalCostProductMatch/, '목록 SQL은 매칭데이터 ProdKey를 써야 한다.');
assert.match(lib, /OrderYear=@year/, '연도는 교차연도 충돌을 막기 위해 유지한다.');
assert.match(api, /MappingAliases/, '행 단위 품목 선택도 매칭 별칭을 검색해야 한다.');

console.log('arrival cost product search tests passed');
