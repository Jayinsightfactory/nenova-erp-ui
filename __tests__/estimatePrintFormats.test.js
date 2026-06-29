// 실행: node __tests__/estimatePrintFormats.test.js

async function main() {
  const {
    getEstimateVarietyLabel,
    applyStatementPrintAmounts,
    computePrintPreviewTotals,
    ESTIMATE_PRINT_FORMAT,
  } = await import('../lib/estimatePrintFormats.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== getEstimateVarietyLabel ===');
  assert('콜롬비아 카네이션', getEstimateVarietyLabel({ CounName: '콜롬비아', FlowerName: '카네이션' }) === '콜롬비아 카네이션');
  assert('중국', getEstimateVarietyLabel({ CounName: '중국', FlowerName: '장미' }) === '중국');
  assert('네덜란드', getEstimateVarietyLabel({ CounName: '네덜란드', FlowerName: '튤립' }) === '네덜란드');

  console.log('\n=== applyStatementPrintAmounts ===');
  const row = applyStatementPrintAmounts({ Cost: 10000, Amount: 90000, Vat: 9000 });
  assert('공급가액=단가', row.Amount === 10000);
  assert('부가세 0.1%', row.Vat === 10);

  console.log('\n=== computePrintPreviewTotals ===');
  const est = computePrintPreviewTotals([{ Amount: 100, Vat: 10, Cost: 110 }], ESTIMATE_PRINT_FORMAT.ESTIMATE);
  assert('견적서 합계', est.total === 110);
  const stmt = computePrintPreviewTotals([{ Cost: 10000 }], ESTIMATE_PRINT_FORMAT.STATEMENT);
  assert('거래명세표 합계', stmt.total === 10010);

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
