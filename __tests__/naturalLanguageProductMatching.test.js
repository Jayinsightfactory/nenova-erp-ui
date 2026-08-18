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
const metrics = calculateMatchingMetrics(Array.from({ length: 20 }, (_, i) => ({ confirmed: true, selectedProdKey: 1, candidateProdKeys: i < 18 ? [1, 2] : [2, 1], candidateScores: [0.9], country: '콜롬비아', flower: '카네이션', createdAt: new Date() })));
assert.equal(metrics.overall.top1, 0.9);
assert.equal(metrics.targetMet, true);
assert.ok(metrics.calibration.brierScore >= 0);
assert.equal(evaluateAliasPromotion(Array.from({ length: 5 }, (_, i) => ({ confirmedByUser: true, autoSelected: false, prodKey: 1, actorId: i % 2 ? 'a' : 'b' }))).eligible, true);
assert.equal(evaluateAliasPromotion(Array.from({ length: 5 }, () => ({ confirmedByUser: true, autoSelected: true, prodKey: 1, actorId: 'a' }))).eligible, false, '자동선택은 alias 승격 정답이 아니다.');
console.log('natural language product matching tests passed');
