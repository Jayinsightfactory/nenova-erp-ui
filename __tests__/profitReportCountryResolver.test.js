const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const resolver = await import('../lib/profitReportCountryResolver.js');
  const classify = (counName, flowerName, productName) =>
    resolver.classifyProfitReportCategory({ counName, flowerName, productName });

  assert.equal(classify('국내', '왁스', 'CARNATION/CHINA'), '중국');
  assert.equal(classify('국내', '왁스', 'ETC/ CHINA'), '중국');
  assert.equal(classify('국내', '왁스', 'ROSE / CHINA'), '중국');
  assert.equal(classify('국내', '왁스', '샘플/단'), '국내');
  assert.equal(classify('국내', '왁스', '샘플/송이'), '국내');
  assert.equal(classify('국내', '왁스', '카네이션 운송료'), '콜롬비아 카네이션');
  assert.equal(classify('콜롬비아', '카네이션', 'CARNATION/CHINA'), '콜롬비아 카네이션', '확인된 수입국가는 품명 CHINA 단서보다 우선한다.');
  assert.equal(classify('국내', '기타', 'Gross weigth'), null);
  assert.equal(resolver.CATEGORIES.length, 16, '원본 본표 16행을 유지해야 한다.');
  assert.equal(resolver.CATEGORIES.at(-1).key, '공제');
  assert.equal(resolver.profitReportCategoriesForWeek(27).at(-1).key, '공제');
  assert.equal(resolver.profitReportCategoriesForWeek(28).at(-1).key, '국내');
  assert.equal(resolver.currencyCodeForCategory('호주'), 'AUD');
  assert.equal(resolver.currencyCodeForCategory('중국'), 'CNY');
  assert.equal(resolver.currencyCodeForCategory('콜롬비아 장미'), 'USD');
  assert.equal(resolver.currencyCodeForCategory('베트남'), 'USD');
  assert.equal(resolver.currencyCodeForCategory('네덜란드'), 'EUR');
  assert.equal(resolver.currencyCodeForCategory('국내'), null);
  assert.equal(resolver.currencyCodeForCategory('존재하지 않는 국가'), null, '미등록 국가는 USD로 추정하면 안 된다.');

  const sqlCase = resolver.buildProfitReportCategorySql('p');
  assert.ok(sqlCase.indexOf("LIKE N'%CHINA%'") > sqlCase.indexOf("LIKE N'%베트남%'"));
  // Execute the generated CASE predicates over fixtures (not a copied country policy).
  // This bounded evaluator supports only the SQL expressions emitted by this generator.
  const evaluateSqlCase = row => {
    for (const match of sqlCase.matchAll(/WHEN ([\s\S]*?) THEN N'([^']+)'/g)) {
      const condition = match[1]
        .replace(/(?:UPPER\()?ISNULL\(p\.(ProdName|CounName|FlowerName),N''\)\)? LIKE N'([^']*)'/g,
          (_, column, pattern) => String(new RegExp(`^${pattern.replace(/%/g, '.*')}$`, 'i').test(String(row[column] ?? ''))))
        .replace(/\bAND\b/g, '&&').replace(/\bOR\b/g, '||');
      assert.match(condition, /^[truefals\s&|()]+$/, 'every generated SQL predicate must be evaluated');
      if (Function(`return (${condition});`)()) return match[2];
    }
    return sqlCase.match(/ELSE N'([^']+)'/)[1];
  };
  const classificationFixtures = [
    ['네덜란드', '히아신스', 'Hyacinthus / China Pink', '네덜란드'],
    ['네덜란드', '유칼립투스', 'Eucalyptus / Domenichina', '네덜란드'],
    ['중국', '히아신스', 'Hyacinthus / China Pink', '중국'],
    ['국내', '왁스', 'CARNATION/CHINA', '중국'],
    ['', '', 'ROSE / CHINA', '중국'],
    [null, null, '중국 장미', '중국'],
    ['화성', '', 'CHINA Sample', '중국'],
    ['', '', 'Hyacinthus Pink', resolver.EXTRA_CATEGORY],
    ['콜롬비아', '카네이션', 'CARNATION/CHINA', '콜롬비아 카네이션'],
    ['콜롬비아', '미확인', 'CHINA Sample', '중국'],
    ['콜롬비아', '아나나스', '[MEL] ROSE CHINA / 플라터 레드 (Plateau Red) ', '중국'],
    ['콜롬비아', '아나나스', 'Unclassified Sample', resolver.EXTRA_CATEGORY],
    ['국내', '왁스', 'CHINA 샘플', '중국'],
    ['국내', '왁스', '샘플/단', '국내'],
    ['국내', '수국', 'HYDRANGEA White', '콜롬비아 수국'],
    ['네덜란드', '히아신스', '중국 운송료', '중국'],
    ['중국', '기타', '네덜란드 운송료', '네덜란드'],
    ['네덜란드', '히아신스', '중국 운송 색상', '네덜란드'],
    ['중국', '카네이션', '카네이션 운송료', '콜롬비아 카네이션'],
    ['호주', '기타', 'China Pink', '호주'],
    ['태국', '기타', 'China Pink', '태국'],
    ['에콰도르', '기타', 'China Pink', '에콰도르'],
  ];
  for (const [CounName, FlowerName, ProdName, expected] of classificationFixtures) {
    assert.equal(classify(CounName, FlowerName, ProdName), expected, `JS ${CounName}/${ProdName}`);
    assert.equal(evaluateSqlCase({ CounName, FlowerName, ProdName }), expected, `SQL ${CounName}/${ProdName}`);
  }
  const observedReceipt = Object.freeze({ OrderYear: '2026', OrderWeek: '31-02', ProdKey: 2880,
    CounName: '네덜란드', FlowerName: '히아신스', ProdName: 'Hyacinthus / China Pink',
    TPrice: 18.5, SteamQuantity: 50, EstQuantity: 10 });
  const before = JSON.stringify(observedReceipt);
  for (const OrderYear of ['2025', '2026']) {
    const receipt = { ...observedReceipt, OrderYear };
    assert.equal(evaluateSqlCase(receipt), '네덜란드', `${OrderYear}/31-02 classification is metadata-only`);
    assert.equal(resolver.currencyCodeForCategory(classify(receipt.CounName, receipt.FlowerName, receipt.ProdName)), 'EUR');
  }
  assert.equal(JSON.stringify(observedReceipt), before, 'classification cannot alter year/week, amount or quantities');
  const observedPlaceholder = Object.freeze({ ProdKey: 2735, CounName: '콜롬비아', FlowerName: '아나나스',
    ProdName: '[MEL] ROSE CHINA / 플라터 레드 (Plateau Red) ', EstUnit: '단', OutUnit: '단' });
  assert.equal(classify(observedPlaceholder.CounName, observedPlaceholder.FlowerName, observedPlaceholder.ProdName), '중국',
    'actual product 2735 retains CHINA fallback when country+flower cannot resolve a report category');
  assert.equal(evaluateSqlCase(observedPlaceholder), '중국');
  assert.match(sqlCase, /THEN N'국내'/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'lib', 'profitReportCountryResolver.js'), 'utf8'), /\|\|\s*'USD'/,
    '통화 미등록 fallback은 INPUT_REQUIRED 경로로 남겨야 한다.');

  const reportSource = fs.readFileSync(path.join(root, 'lib/profitReport.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(root, 'pages/api/sales/profit-report.js'), 'utf8');
  assert.match(reportSource, /buildProfitReportCategorySql\('p'\)/, 'SQL 집계도 단일 resolver를 사용해야 한다.');
  assert.match(apiSource, /profitReportCategoriesForWeek\(currentMajor\)/, 'API 행 목록도 주차별 resolver를 사용해야 한다.');

  console.log('profit report country/currency resolver tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
