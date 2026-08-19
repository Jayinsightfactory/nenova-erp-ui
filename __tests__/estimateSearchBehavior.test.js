// 견적서관리 검색 계약 테스트
//
// 1) 거래처: 드롭다운에서 업체를 고른 뒤 검색이 다시 돌아 다른 업체로 바뀌지 않는다.
// 2) 품목: 점수 계산을 캐시/디바운스로 가속해도 순위 결과는 바뀌지 않는다.
//
// 품목 검색은 전체 카탈로그를 훑는 무거운 계산이라 캐시를 도입했다. 캐시가 결과를
// 바꾸면 담당자가 엉뚱한 품목을 고르게 되므로, 같은 입력에 대한 순위를 고정해 둔다.

import assert from 'assert';
import fs from 'fs';

import { shouldRunCustomerSearch } from '../lib/customerSearch.js';
import { rankProductSearchOptions, scoreProductSearchOptions } from '../lib/productSearchRanking.js';
import { scoreMatch, tokenizeForMatch } from '../lib/displayName.js';
import { PRODUCT_SEARCH_DEBOUNCE_MS, PRODUCT_SEARCH_RESULT_LIMIT } from '../lib/productSearchLimits.js';

// ── 1. 거래처 재검색 차단
assert.equal(shouldRunCustomerSearch('', null), false, '빈 검색어는 조회하지 않는다.');
assert.equal(shouldRunCustomerSearch('꽃', null), true, '타이핑한 검색어는 조회한다.');
assert.equal(shouldRunCustomerSearch('영남꽃소재', '영남꽃소재'), false,
  '선택으로 채워진 업체명은 재검색하지 않는다. 재검색하면 목록이 다시 열리고 선택이 바뀐다.');
assert.equal(shouldRunCustomerSearch('영남꽃소재', '주광농원'), true,
  '다른 업체를 선택한 뒤 검색어를 직접 바꾸면 다시 조회한다.');
assert.equal(shouldRunCustomerSearch('영남꽃', '영남꽃소재'), true,
  '선택 업체명의 일부만 남기면 새 검색으로 취급한다.');

const pageSource = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');

assert.match(pageSource, /const custReqSeq = useRef\(0\)/,
  '늦게 온 이전 검색 응답을 버릴 요청 순번이 있어야 한다.');
assert.match(pageSource, /if \(seq !== custReqSeq\.current\) return;/,
  '검색 응답은 최신 요청일 때만 목록에 반영해야 한다.');
assert.match(pageSource, /custPickedName\.current = c\.CustName/,
  '업체 선택 시 선택된 업체명을 기록해 재검색을 막아야 한다.');
assert.match(pageSource, /shouldRunCustomerSearch\(custSearch, custPickedName\.current\)/,
  '검색 이펙트는 선택 직후 재검색을 건너뛰어야 한다.');
assert.match(pageSource, /if \(e\.key === 'Enter' && !showCustDrop\) return;/,
  '목록이 닫힌 상태의 Enter가 첫 항목을 다시 선택하면 업체가 바뀐다.');
assert.match(pageSource, /custList\.length > 0 && !selectedCust/,
  '이미 업체를 골랐으면 포커스만으로 목록을 다시 열지 않는다.');

// ── 2. 품목 검색 가속 계약
assert.match(pageSource, /const prodOptions = useMemo\(/,
  '품목 옵션이 매 렌더마다 새 객체면 품목 점수 캐시가 무효화된다.');
assert.match(pageSource, /useDebouncedValue\(q, PRODUCT_SEARCH_DEBOUNCE_MS\)/,
  '품목 검색은 타이핑이 멈춘 뒤 계산해야 한다.');
assert.match(pageSource, /limit: PRODUCT_SEARCH_RESULT_LIMIT/,
  '검색어가 없을 때 전체 목록을 그리면 드롭다운이 멈춘다.');

const modalSource = fs.readFileSync(
  new URL('../components/estimate/OrderRegisterDistributeModal.js', import.meta.url), 'utf8');
assert.match(modalSource, /useDebouncedValue\(prodSearchKey, PRODUCT_SEARCH_DEBOUNCE_MS\)/,
  '추가품목등록 품목 검색도 디바운스해야 한다.');
assert.match(modalSource, /prodResultsByLine = useMemo\(/,
  '추가품목등록은 수량만 바뀐 리렌더에서 품목 점수를 다시 계산하지 않아야 한다.');
assert.ok(PRODUCT_SEARCH_DEBOUNCE_MS > 0 && PRODUCT_SEARCH_RESULT_LIMIT > 0);

// ── 3. 캐시가 순위를 바꾸지 않는다 (고정 fixture)
const UNITS = ['박스', '단', '스팀(대)'];
const CATALOG = [
  ['CARNATION MOONLIGHT', 'CARNATION', 'COLOMBIA', 900, 100],
  ['CARNATION CANDLELIGHT', 'CARNATION', 'COLOMBIA', 400, 40],
  ['CARNATION JINDA SWEET', 'CARNATION', 'CHINA', 120, 10],
  ['ROSE RED NAOMI', 'ROSE', 'ECUADOR', 800, 90],
  ['ROSE FREEDOM', 'ROSE', 'ECUADOR', 300, 20],
  ['ROSE-2-BOX SPECIAL', 'ROSE', 'COLOMBIA', 10, 1],
  ['HYDRANGEA BLUE', 'HYDRANGEA', 'NETHERLANDS', 500, 50],
  ['RUSCUS ITALIA', 'RUSCUS', 'THAILAND', 200, 5],
  ['ALSTROEMERIA WHISTLER', 'ALSTROEMERIA', 'COLOMBIA', 150, 15],
  ['TULIP SNOW WHITE', 'TULIP', 'NETHERLANDS', 60, 3],
].map(([name, flower, coun, usage, recent], i) => ({
  value: String(i + 1), label: name, sub: `${coun} · ${flower} · ${UNITS[i % 3]}`,
  ProdKey: i + 1, ProdCode: `P${String(i + 1).padStart(5, '0')}`,
  ProdName: name, DisplayName: name, FlowerName: flower, CounName: coun,
  OutUnit: UNITS[i % 3], EstUnit: UNITS[i % 3],
  UsageCount: usage, RecentUsageCount: recent, MappingCount: 0,
}));

const EXPECTED_TOP = {
  carnation: ['CARNATION MOONLIGHT', 'CARNATION CANDLELIGHT', 'CARNATION JINDA SWEET'],
  '카네이션': ['CARNATION MOONLIGHT', 'CARNATION CANDLELIGHT', 'CARNATION JINDA SWEET'],
  moonlight: ['CARNATION MOONLIGHT'],
  jinda: ['CARNATION JINDA SWEET'],
  '진다': ['CARNATION JINDA SWEET'],
  rose: ['ROSE RED NAOMI', 'ROSE FREEDOM', 'ROSE-2-BOX SPECIAL'],
  '장미': ['ROSE RED NAOMI', 'ROSE FREEDOM', 'ROSE-2-BOX SPECIAL'],
  hydrangea: ['HYDRANGEA BLUE'],
  whistler: ['ALSTROEMERIA WHISTLER'],
};

for (const [query, expected] of Object.entries(EXPECTED_TOP)) {
  const ranked = rankProductSearchOptions(query, CATALOG, { limit: PRODUCT_SEARCH_RESULT_LIMIT })
    .map((o) => o.ProdName);
  assert.deepEqual(ranked.slice(0, expected.length), expected,
    `"${query}" 검색 순위가 바뀌었다. 품목 검색 캐시는 순위를 바꾸면 안 된다.`);
}

// 같은 입력을 반복해도(캐시가 채워진 뒤에도) 결과가 같아야 한다.
for (const query of Object.keys(EXPECTED_TOP)) {
  const first = rankProductSearchOptions(query, CATALOG, { limit: 200 }).map((o) => o.ProdKey);
  const second = rankProductSearchOptions(query, CATALOG, { limit: 200 }).map((o) => o.ProdKey);
  assert.deepEqual(second, first, `"${query}" 재검색 결과가 캐시 상태에 따라 달라진다.`);
}

// 점수 자체도 재현 가능해야 한다.
for (const query of ['carnation', '장미', 'rose-2-box']) {
  const run = () => scoreProductSearchOptions(query, CATALOG)
    .map((i) => [i.product.ProdKey, i.rankScore.toFixed(6), i.matchScore.toFixed(6)]);
  assert.deepEqual(run(), run(), `"${query}" 점수가 캐시 상태에 따라 달라진다.`);
}

// scoreMatch도 반복 호출에서 같은 값이어야 한다.
for (const product of CATALOG) {
  const a = scoreMatch('carnation moonlight', product, '');
  const b = scoreMatch('carnation moonlight', product, '');
  assert.equal(b, a, `${product.ProdName} scoreMatch가 캐시 상태에 따라 달라진다.`);
}

// tokenizeForMatch는 캐시된 배열을 그대로 넘기지 않는다 (호출부 변형 방지).
const tokensA = tokenizeForMatch('CARNATION JINDA SWEET');
const tokensB = tokenizeForMatch('CARNATION JINDA SWEET');
assert.deepEqual(tokensB, tokensA);
assert.notStrictEqual(tokensB, tokensA, '캐시된 토큰 배열을 공유하면 호출부 변형이 캐시를 오염시킨다.');
tokensA.push('오염');
assert.deepEqual(tokenizeForMatch('CARNATION JINDA SWEET'), tokensB,
  '반환 배열을 변형해도 캐시는 오염되지 않아야 한다.');

console.log('estimate search behavior tests passed');
