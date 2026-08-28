import assert from 'node:assert/strict';
import { calculateMatchingMetrics, evaluateAliasPromotion, normalizeProductQuery, scoreNaturalLanguageProducts } from '../lib/naturalLanguageProductMatching.js';
import { rankProductSearchOptions } from '../lib/productSearchRanking.js';

const products = [
  { ProdKey: 1, ProdName: 'CARNATION Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단', UsageCount: 2200 },
  { ProdKey: 2, ProdName: 'ROSE / Candlelight 50cm', DisplayName: '장미 캔들라이트', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
  { ProdKey: 3, ProdName: 'CARNATION CHINA / Moonlight', DisplayName: '중국 카네이션 문라이트', FlowerName: '카네이션', CounName: '중국', OutUnit: '박스', UsageCount: 10 },
];
assert.deepEqual(normalizeProductQuery(' (콜롬비아) 카네 문 라이트 10단 ').country, '콜롬비아');
assert.equal(normalizeProductQuery('중국 ROSE 2 box').unit, '박스');
const moon = scoreNaturalLanguageProducts('콜롬비아 카네이션 문라이트 단', products);
assert.equal(moon.candidates[0].prodKey, 1);
assert.equal(moon.candidates.some((x) => x.prodKey === 2), false, '장미/카네이션 충돌 후보는 정상 후보에 섞지 않는다.');
assert.equal(moon.alternateCountry[0].prodKey, 3);
assert.equal(moon.alternateCountry[0].autoSelect, false);
const china = scoreNaturalLanguageProducts('중국 카네이션 문라이트 박스', products);
assert.equal(china.candidates[0].prodKey, 3);
const ness = rankProductSearchOptions('네스', [
  { ProdKey: 4, ProdName: 'CARNATION Ness', DisplayName: '카네이션 네스', FlowerName: '카네이션', CounName: '콜롬비아', UsageCount: 10 },
  { ProdKey: 5, ProdName: 'CARNATION Nelson', DisplayName: '카네이션 넬슨', FlowerName: '카네이션', CounName: '콜롬비아', UsageCount: 1000 },
], { limit: 2 });
assert.equal(ness[0].ProdKey, 4, '한글 품종명 네스는 사용량이 많은 유사 영문명보다 CARNATION Ness를 우선해야 한다.');
const aliasOnly = scoreNaturalLanguageProducts('문라이트', [
  { ProdKey: 9, ProdName: 'CARNATION Moon Light', DisplayName: '', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단', MappingAliases: ['문라이트'] },
  { ProdKey: 8, ProdName: 'ROSE / Candlelight 50cm', DisplayName: '장미 캔들라이트', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
]);
assert.equal(aliasOnly.candidates[0].prodKey, 9, '매칭데이터 별칭만 있어도 해당 품목이 먼저 나와야 한다.');
const solomio = scoreNaturalLanguageProducts('SOLOMIO ROSE PINK', [
  { ProdKey: 10, ProdName: 'Solomio Pink', DisplayName: '솔로미오 핑크', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
  { ProdKey: 11, ProdName: 'Solomio White', DisplayName: '솔로미오 화이트', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
  { ProdKey: 12, ProdName: 'Solomio Pink', DisplayName: '솔로미오 핑크', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
  { ProdKey: 13, ProdName: 'SOLOMIO ROSE (PINK)', DisplayName: '', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
]);
assert.equal(solomio.candidates[0].prodKey, 13, '전산 전체 품목명 SOLOMIO ROSE (PINK)가 있으면 사용량이 많은 축약 품목보다 먼저 매칭한다.');
assert.equal(solomio.candidates[0].autoSelect, true);
assert.ok(solomio.candidates[0].reasons.includes('master-name-exact'));
assert.equal(solomio.candidates.find((x) => x.prodKey === 10)?.autoSelect, false, '화종 단어를 생략한 축약 후보는 정확한 전산 품목과 같은 만점으로 올리지 않는다.');
assert.equal(solomio.candidates.find((x) => x.prodKey === 11)?.autoSelect, false, 'SOLOMIO 철자만 같고 PINK/WHITE가 다른 후보는 사용량이 많아도 자동 선택하지 않는다.');
assert.equal(solomio.candidates.some((x) => x.prodKey === 12), false, '꽃 종류가 다른 동명 품목은 정상 후보에 섞지 않는다.');
const exactWithMissingFlower = scoreNaturalLanguageProducts('SOLOMIO ROSE PINK', [
  { ProdKey: 14, ProdName: 'SOLOMIO ROSE (PINK)', DisplayName: '', FlowerName: '', CounName: '콜롬비아', OutUnit: '단' },
]);
assert.equal(exactWithMissingFlower.candidates[0].prodKey, 14, '전산 전체 품목명이 정확하면 화종 메타데이터가 비어 있어도 수동 후보에서 숨기지 않는다.');
assert.equal(exactWithMissingFlower.candidates[0].autoSelect, false, '화종 메타데이터 충돌 후보는 자동 선택하지 않는다.');
const solomioRepeatedLetterTypo = scoreNaturalLanguageProducts('SOLOOMIO ROSE PINK', [
  { ProdKey: 15, ProdName: 'SOLOMIO ROSE (PINK)', DisplayName: '', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
  { ProdKey: 16, ProdName: 'SOLAR ROSE (PINK)', DisplayName: '', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단', UsageCount: 9000 },
]);
assert.equal(solomioRepeatedLetterTypo.candidates[0].prodKey, 15, 'SOLOMIO의 반복 O가 하나 더 입력돼도 철자 개수와 순서를 함께 비교해 실제 품목을 먼저 찾는다.');
const solomioTransposedLetter = scoreNaturalLanguageProducts('SOOLMIO ROSE PINK', [
  { ProdKey: 15, ProdName: 'SOLOMIO ROSE (PINK)', DisplayName: '', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
]);
assert.equal(solomioTransposedLetter.candidates[0].prodKey, 15, 'S×1/O×3/L·M·I×1 구성이 같은 인접 자리바꿈도 후보로 유지한다.');
const inventoryOnlyAnagram = scoreNaturalLanguageProducts('OOSMILO ROSE PINK', [
  { ProdKey: 15, ProdName: 'SOLOMIO ROSE (PINK)', DisplayName: '', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
]);
assert.equal(inventoryOnlyAnagram.candidates[0].autoSelect, false, '철자 개수만 같고 순서가 크게 다른 입력은 자동 확정하지 않는다.');
const solomioRoseCarnation = scoreNaturalLanguageProducts('SOLOMIO ROSE PINK', [
  { ProdKey: 20, ProdCode: 'CAR01-CHI020', ProdName: 'Spray Carnation CHINA / 솔로미오 Solomio Rose (pink)', DisplayName: 'SPRAY 카네이션 CHINA / 솔로미오 SOLOMIO 장미 (PINK)', FlowerName: '카네이션', CounName: '중국', OutUnit: '단' },
  { ProdKey: 21, ProdCode: 'CAR01-CHI999', ProdName: 'Spray Carnation CHINA / Solomio White', DisplayName: '', FlowerName: '카네이션', CounName: '중국', OutUnit: '단', UsageCount: 9000 },
]);
assert.equal(solomioRoseCarnation.candidates[0].prodKey, 20, '전산 품목명 속 ROSE는 카네이션 화종 충돌이 아니라 Solomio Rose 품종명 일부로 검색한다.');
assert.equal(solomioRoseCarnation.candidates[0].conflicts.flower, false);
assert.ok(solomioRoseCarnation.candidates[0].reasons.includes('flower-token-in-product-name'));
assert.equal(solomioRoseCarnation.candidates.some((x) => x.prodKey === 21), false, '전산 품목명에 ROSE가 없는 카네이션 후보는 기존 화종 충돌 차단을 유지한다.');
const solomioWrongColor = scoreNaturalLanguageProducts('SOLOMIO ROSE WHITE', [
  { ProdKey: 10, ProdName: 'Solomio Pink', DisplayName: '솔로미오 핑크', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
]);
assert.equal(solomioWrongColor.candidates[0].autoSelect, false, '색상이 다른 품목을 꽃 종류 제거만으로 자동 선택하지 않는다.');
const metrics = calculateMatchingMetrics(Array.from({ length: 20 }, (_, i) => ({ confirmed: true, selectedProdKey: 1, candidateProdKeys: i < 18 ? [1, 2] : [2, 1], candidateScores: [0.9], country: '콜롬비아', flower: '카네이션', createdAt: new Date() })));
assert.equal(metrics.overall.top1, 0.9);
assert.equal(metrics.targetMet, true);
assert.ok(metrics.calibration.brierScore >= 0);
assert.equal(evaluateAliasPromotion(Array.from({ length: 5 }, (_, i) => ({ confirmedByUser: true, autoSelected: false, prodKey: 1, actorId: i % 2 ? 'a' : 'b' }))).eligible, true);
assert.equal(evaluateAliasPromotion(Array.from({ length: 5 }, () => ({ confirmedByUser: true, autoSelected: true, prodKey: 1, actorId: 'a' }))).eligible, false, '자동선택은 alias 승격 정답이 아니다.');
console.log('natural language product matching tests passed');
