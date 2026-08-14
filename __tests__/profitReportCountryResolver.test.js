const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const resolver = await import('../lib/profitReportCountryResolver.js');
  const classify = (counName, flowerName, productName) =>
    resolver.classifyProfitReportCategory({ counName, flowerName, productName });

  assert.equal(classify('국내', '왁스', 'CARNATION/CHINA'), '중국');
  assert.equal(classify('국내', '왁스', 'ETC/ CHINA'), '중국');
  assert.equal(classify('국내', '왁스', 'ROSE / CHINA'), '중국');
  assert.equal(classify('국내', '왁스', '샘플/단'), '국내');
  assert.equal(classify('국내', '왁스', '샘플/송이'), '국내');
  assert.equal(classify('국내', '왁스', '카네이션 운송료'), '콜롬비아 카네이션');
  assert.equal(classify('콜롬비아', '카네이션', 'CARNATION/CHINA'), '중국', 'CHINA 단서가 화종보다 우선해야 한다.');
  assert.equal(classify('국내', '기타', 'Gross weigth'), null);
  assert.equal(resolver.CATEGORIES.length, 16, '원본 본표 16행을 유지해야 한다.');
  assert.equal(resolver.CATEGORIES.at(-1).key, '공제');
  assert.equal(resolver.profitReportCategoriesForWeek(27).at(-1).key, '공제');
  assert.equal(resolver.profitReportCategoriesForWeek(28).at(-1).key, '국내');
  assert.equal(resolver.currencyCodeForCategory('호주'), 'AUD');
  assert.equal(resolver.currencyCodeForCategory('중국'), 'CNY');
  assert.equal(resolver.currencyCodeForCategory('국내'), null);

  const sqlCase = resolver.buildProfitReportCategorySql('p');
  assert.ok(sqlCase.indexOf("LIKE N'%CHINA%'") < sqlCase.indexOf("LIKE N'%콜롬비아%'"));
  assert.match(sqlCase, /THEN N'국내'/);

  const root = path.resolve(__dirname, '..');
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
