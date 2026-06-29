// 실행: node __tests__/estimatePrintFormats.test.js

async function main() {
  const {
    getEstimateOriginCountry,
    getStatementProductName,
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

  console.log('=== getEstimateOriginCountry ===');
  assert('콜롬비아만', getEstimateOriginCountry({ CounName: '콜롬비아', FlowerName: '장미' }) === '콜롬비아');
  assert('중국만', getEstimateOriginCountry({ CounName: '중국', FlowerName: '장미' }) === '중국');
  assert('에콰도르', getEstimateOriginCountry({ CounName: '에콰도르', FlowerName: '장미' }) === '에콰도르');

  console.log('\n=== getStatementProductName ===');
  assert('Hydrangea Lavender', getStatementProductName({ ProdName: 'HYDRANGEA Lavender' }) === 'Lavender');
  assert('Carnation Fifi', getStatementProductName({ ProdName: 'CARNATION Fifi' }) === 'Fifi');
  assert('중국 프라우드', getStatementProductName({ ProdName: 'ROSE CHINA / 프라우드 (White proud) 75-80cm' }) === '프라우드 (White proud)');
  assert('Momentum', getStatementProductName({ ProdName: 'ROSE / Momentum 50cm' }) === 'Momentum');

  console.log('\n=== getEstimateSpecLabel ===');
  assert('50cm', getEstimateSpecLabel({ ProdName: 'ROSE / Momentum 50cm' }) === '50cm');

  console.log('\n=== applyStatementPrintAmounts ===');
  const row1 = applyStatementPrintAmounts({ Cost: 12100, Amount: 11000, Quantity: 1, Vat: 1100 });
  assert('세액 10%=1100', row1.Vat === 1100);

  console.log('\n=== computePrintPreviewTotals ===');
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
