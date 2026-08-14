const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { ALLOWED_INPUT_DIRECTORY, runProfitReportAcceptance } = await import('./helpers/profitReportAcceptance.mjs');
  const originals = Object.fromEntries(Array.from({ length: 7 }, (_, index) => index + 22).map(week => {
    const file = path.join(ALLOWED_INPUT_DIRECTORY, `week-${week}.xlsx`);
    const stat = fs.statSync(file);
    return [week, { bytes: stat.size, mtimeMs: stat.mtimeMs }];
  }));
  const result = await runProfitReportAcceptance();

  assert.equal(result.summary.fail, 0, JSON.stringify(result.weeks.flatMap(week => week.checks).filter(check => check.status === 'FAIL'), null, 2));
  assert.equal(result.overallStatus, 'INPUT_REQUIRED');
  assert.deepEqual(result.weeks.map(week => week.week), [22, 23, 24, 25, 26, 27, 28]);
  assert.ok(result.weeks.every(week => week.inputUnchanged));
  assert.ok(result.weeks.every(week => week.mappingRate === 1));
  assert.ok(result.weeks.every(week => week.formulaFingerprintRate === 1));
  assert.ok(result.weeks.every(week => week.checks.find(check => check.id === 'amount-parity-krw')?.status === 'PASS'));
  assert.ok(result.weeks.every(week => week.checks.find(check => check.id === 'ratio-parity')?.status === 'PASS'));
  assert.equal(result.weeks.find(week => week.week === 24).source.sheetNames.length, 12);
  assert.equal(result.weeks.find(week => week.week === 28).source.report.categories[15], '국내');
  assert.equal(result.weeks.find(week => week.week === 22).source.report.categories[15], '공제');
  assert.equal(result.weeks.find(week => week.week === 28).source.report.totalU.formula, 'SUM(U7:U20)');
  assert.equal(result.summary.manualFieldTypeCount, 7);
  assert.equal(result.summary.manualInputSlotCount, 49);
  assert.equal(result.formulaSpecification.sha256, '222484dc07e392ad88d52b7a0f9406c4e19b21af7de97500d176ed726b8234bb');
  assert.ok(result.formulaSpecification.checks.every(check => check.status === 'FORMULA_PARITY'));
  assert.deepEqual(result.continuity.filter(item => item.status === 'FORMULA_PARITY').map(item => item.transition), ['22->23', '23->24', '24->25', '25->26', '27->28']);
  const anomaly = result.continuity.find(item => item.transition === '26->27');
  assert.equal(anomaly.status, 'WORKBOOK_ANOMALY');
  assert.ok(Math.abs(anomaly.difference - 3658862.88875) <= 1);
  assert.deepEqual(anomaly.categoryDifferences.map(item => item.category), ['베트남']);
  assert.equal(result.summary.workbookAnomaly, 1);
  for (const [week, before] of Object.entries(originals)) {
    const stat = fs.statSync(path.join(ALLOWED_INPUT_DIRECTORY, `week-${week}.xlsx`));
    assert.deepEqual({ bytes: stat.size, mtimeMs: stat.mtimeMs }, before);
  }
  await assert.rejects(() => runProfitReportAcceptance({ workbookPath: path.join(ALLOWED_INPUT_DIRECTORY, 'another.xlsx') }), /허용되지 않은 workbook 입력/);
  console.log('profit report evidence-RAG acceptance harness tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
