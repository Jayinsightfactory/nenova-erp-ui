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
  assert.equal(resolver.CATEGORIES.at(-1).key, '국내');
  assert.equal(resolver.currencyCodeForCategory('호주'), 'AUD');
  assert.equal(resolver.currencyCodeForCategory('중국'), 'CNY');
  assert.equal(resolver.currencyCodeForCategory('국내'), null);

  const manual = resolver.resolveProfitReportRate({
    category: '호주', currentMajor: 29, manualRate: 910, invoiceRate: 900,
    previousConfirmedRate: 880, currencyMasterRate: 870,
  });
  assert.equal(manual.effectiveRate, 910);
  assert.equal(manual.source, 'manual_invoice');
  assert.equal(manual.autoRate, 900);

  const invoice = resolver.resolveProfitReportRate({
    category: '호주', currentMajor: 29, invoiceRate: 900,
    previousConfirmedRate: 880, currencyMasterRate: 870,
  });
  assert.equal(invoice.effectiveRate, 900);
  assert.equal(invoice.source, 'freight_cost_snapshot');

  const australiaCarry = resolver.resolveProfitReportRate({
    category: '호주', currentMajor: 29, previousConfirmedRate: 880, currencyMasterRate: 870,
  });
  assert.equal(australiaCarry.effectiveRate, 880, '호주 29차는 28차 R을 상속할 수 있어야 한다.');
  assert.equal(australiaCarry.source, 'previous_report_taxable_rate');

  const vietnam29 = resolver.resolveProfitReportRate({
    category: '베트남', currentMajor: 29, previousConfirmedRate: 1550, currencyMasterRate: 1500,
  });
  assert.equal(vietnam29.effectiveRate, 1500, '베트남 29차는 입력 시작 전 28차 R을 상속하면 안 된다.');
  assert.equal(vietnam29.source, 'currency_master_fallback');
  const vietnam30 = resolver.resolveProfitReportRate({
    category: '베트남', currentMajor: 30, previousConfirmedRate: 1550, currencyMasterRate: 1500,
  });
  assert.equal(vietnam30.effectiveRate, 1550);
  assert.equal(vietnam30.source, 'previous_report_taxable_rate');
  assert.equal(resolver.canCarryPreviousTaxableRate('호주', 1), false);
  assert.equal(resolver.canCarryPreviousTaxableRate('호주', 29, { sameOrderYear: false }), false);

  const sqlCase = resolver.buildProfitReportCategorySql('p');
  assert.ok(sqlCase.indexOf("LIKE N'%CHINA%'") < sqlCase.indexOf("LIKE N'%콜롬비아%'"));
  assert.match(sqlCase, /THEN N'국내'/);

  const root = path.resolve(__dirname, '..');
  const reportSource = fs.readFileSync(path.join(root, 'lib/profitReport.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(root, 'pages/api/sales/profit-report.js'), 'utf8');
  assert.match(reportSource, /buildProfitReportCategorySql\('p'\)/, 'SQL 집계도 단일 resolver를 사용해야 한다.');
  assert.match(apiSource, /resolveProfitReportRate\(/, 'API R 선택도 단일 resolver를 사용해야 한다.');

  const snapshotRegistry = JSON.parse(fs.readFileSync(path.join(root, 'data/profit-report-confirmed-snapshots.json'), 'utf8'));
  const week28 = snapshotRegistry.weeks.find(row => row.orderYear === '2026' && row.majorWeek === '28');
  const domestic = week28.rows.find(row => row.category === '국내');
  assert.equal(domestic.values.C, 619546, '28차 국내 샘플 매출 619,546원이 국내 행에 남아야 한다.');
  assert.equal(week28.rows.some(row => row.category === '공제'), false);

  console.log('profit report country/currency resolver tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
