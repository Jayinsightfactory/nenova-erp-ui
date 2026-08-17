const assert = require('node:assert/strict');

async function main() {
  const { compareIndependentFormulaRecalculation } = await import('../lib/profitReportEvidence/regeneration.mjs');
  const cell = (sheet, address, value, formula = null) => ({
    id: `${sheet}!${address}`,
    sheet,
    address,
    value,
    rawValue: value,
    formula,
  });
  const entries = [
    cell('주차별 매출이익 보고서', 'B7', '태국'),
    cell('주차별 매출이익 보고서', 'N7', 1000),
    cell('주차별 매출이익 보고서', 'L7', -100),
    cell('주차별 매출이익 보고서', 'O7', 50),
    cell('주차별 매출이익 보고서', 'Q7', 2),
    cell('주차별 매출이익 보고서', 'R7', 1500),
    cell('주차별 매출이익 보고서', 'S7', 1),
    cell('주차별 매출이익 보고서', 'E7', 200),
    cell('주차별 매출이익 보고서', 'F7', 300),
    cell('주차별 매출이익 보고서', 'H7', 100),
    cell('주차별 매출이익 보고서', 'C7', 950, '=N7+L7+O7'),
    cell('주차별 매출이익 보고서', 'G7', 4500, '=Q7*R7+S7*R7'),
    cell('주차별 매출이익 보고서', 'I7', 4500, '=E7+G7+H7-F7'),
    cell('주차별 매출이익 보고서', 'J7', -3550, '=C7-I7'),
    cell('주차별 매출이익 보고서', 'K7', -3550 / 950, '=IFERROR((J7/C7),"")'),
    cell('불량차감', 'J1', '태국'),
    cell('불량차감', 'F1', -10),
    cell('주차별 매출이익 보고서', 'M7', -10, '=SUMIF(불량차감!$J:$J,\'주차별 매출이익 보고서\'!B7,불량차감!$F:$F)'),
  ];
  const sourceEvidence = { registry: Object.fromEntries(entries.map(item => [item.id, item])) };
  const result = compareIndependentFormulaRecalculation(sourceEvidence);
  assert.equal(result.status, 'PASS', JSON.stringify(result, null, 2));
  assert.equal(result.formula.checked, 6);
  assert.equal(result.checks.find(check => check.id === 'copy-replay-disabled').status, 'PASS');

  const mismatch = { ...sourceEvidence, registry: { ...sourceEvidence.registry, '주차별 매출이익 보고서!C7': cell('주차별 매출이익 보고서', 'C7', 940, '=N7+L7+O7') } };
  assert.equal(compareIndependentFormulaRecalculation(mismatch).status, 'FAIL');
  console.log('profit report independent recalculation tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
