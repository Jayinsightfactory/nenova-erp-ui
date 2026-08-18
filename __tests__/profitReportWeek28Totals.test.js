const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const { computeProfitTotals, WORKBOOK_TAIL_CATEGORIES } = await import('../lib/profitReportCalc.js');
  const evidenceIndex = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'profit-report-evidence', 'registry', 'v1', 'index.json'),
    'utf8',
  ));
  const week28 = evidenceIndex.workbooks.find(item => Number(item.week) === 28);
  assert.equal(week28.lastRowCategory, '국내');
  assert.deepEqual(WORKBOOK_TAIL_CATEGORIES, ['공제', '국내']);

  const row = (category, calc) => ({ category, calc: {
    C: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0,
    L: 0, N: 0, O: 0, P: 0, Q: 0, S: 0, T: 0,
    ...calc,
  } });
  const rows = [
    row('네덜란드', { C: 100, E: 10, F: 11, G: 20, H: 2, I: 21, J: 79, L: -1, N: 101, O: 0, P: 15, Q: 10, S: 3, T: 5 }),
    row('베트남', { C: 50, E: 4, F: 5, G: 9, H: 1, I: 9, J: 41, L: 0, N: 50, O: 0, P: 8, Q: 5, S: 1, T: 1 }),
    row('국내', { C: 30, E: 3, F: 2, G: 7, H: 6, I: 8, J: 22, L: -2, N: 10, O: 22, P: 9, Q: 4, S: 2, T: 3 }),
  ];
  const totals = computeProfitTotals(rows);

  assert.equal(totals.C, 180, 'C는 국내 마지막 행을 포함해야 한다.');
  assert.equal(totals.E, 17, 'E는 국내 마지막 행을 포함해야 한다.');
  assert.equal(totals.F, 18, 'F는 국내 마지막 행을 포함해야 한다.');
  assert.equal(totals.J, 142, 'J는 국내 마지막 행을 포함해야 한다.');
  assert.equal(totals.G, 29, 'G는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.H, 3, 'H는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.I, 30, 'I는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.L, -1, 'L은 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.N, 151, 'N은 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.O, 0, 'O는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.P, 23, 'P는 국내 마지막 행을 제외하고 베트남은 포함해야 한다.');
  assert.equal(totals.Q, 15, 'Q는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.S, 4, 'S는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.T, 6, 'T는 국내 마지막 행을 제외해야 한다.');
  assert.equal(totals.U, 15 / 23, 'U 표시합은 국내와 베트남을 제외하고 분모 P는 베트남을 포함해야 한다.');

  console.log('profit report week-28 workbook total-range tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
