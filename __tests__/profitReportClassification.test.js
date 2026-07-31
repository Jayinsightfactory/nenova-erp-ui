// 주차별 매출이익 보고서 자동 미분류 분류 규칙 회귀 검증
const assert = require('assert');

(async () => {
  const { classifyCategory, isNonValueWeightItem } = await import('../lib/profitReportClassification.js');

  const freightCases = [
    ['현지상차운임', '콜롬비아 수국'],
    ['카네이션 운송료', '콜롬비아 카네이션'],
    ['장미 운송료', '콜롬비아 장미'],
    ['루스커스 운송료', '콜롬비아 루스커스'],
    ['네덜란드 운송료', '네덜란드'],
    ['태국 운송료', '태국'],
    ['중국 운송료', '중국'],
  ];

  for (const [product, expected] of freightCases) {
    assert.strictEqual(classifyCategory('국내', '왁스', product), expected, `${product} 분류`);
  }

  assert.strictEqual(isNonValueWeightItem('Chargeable weight'), true);
  assert.strictEqual(isNonValueWeightItem('Gross weigth'), true);
  assert.strictEqual(classifyCategory('국내', '기타', 'Gross weight'), null);
  assert.strictEqual(classifyCategory('콜롬비아', '카네이션', 'CARNATION Moon Light'), '콜롬비아 카네이션');

  console.log('profitReportClassification.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
