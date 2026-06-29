// 실행: node __tests__/estimatePrintFormats.test.js

async function main() {
  const {
    getEstimateVarietyLabel,
    getEstimateSpecLabel,
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
  assert('콜롬비아 장미', getEstimateVarietyLabel({ CounName: '콜롬비아', FlowerName: '장미' }) === '콜롬비아 장미');
  assert('중국', getEstimateVarietyLabel({ CounName: '중국', FlowerName: '장미' }) === '중국');

  console.log('\n=== getEstimateSpecLabel ===');
  assert('50cm', getEstimateSpecLabel({ ProdName: 'ROSE / Momentum 50cm' }) === '50cm');

  console.log('\n=== applyStatementPrintAmounts ===');
  const row1 = applyStatementPrintAmounts({ Cost: 12100, Amount: 11000, Quantity: 1, Vat: 1100 });
  assert('단가 11000', row1.Cost === 11000);
  assert('금액=수량×단가', row1.Amount === 11000);
  assert('세액 10%=1100', row1.Vat === 1100);

  const row30 = applyStatementPrintAmounts({ Cost: 12100, Amount: 330000, Quantity: 30, Vat: 33000 });
  assert('30단 금액', row30.Amount === 330000);
  assert('30단 세액', row30.Vat === 33000);

  console.log('\n=== computePrintPreviewTotals ===');
  const est = computePrintPreviewTotals([{ Amount: 100, Vat: 10, Cost: 110 }], ESTIMATE_PRINT_FORMAT.ESTIMATE);
  assert('견적서 합계', est.total === 110);
  const stmt = computePrintPreviewTotals(
    [{ Cost: 12100, Amount: 11000, Quantity: 1, Vat: 1100 }],
    ESTIMATE_PRINT_FORMAT.STATEMENT,
  );
  assert('거래명세표 합계', stmt.total === 12100);

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
