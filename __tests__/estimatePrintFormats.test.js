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
  const { prepareEstimatePrintRows } = await import('../lib/estimatePrintPrepare.js');

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
  assert('Hydrangea Blue', getStatementProductName({ ProdName: 'Hydrangea Blue (블루)' }) === 'Blue (블루)');
  assert('Carnation Fifi', getStatementProductName({ ProdName: 'CARNATION Fifi' }) === 'Fifi');
  assert('중국 프라우드', getStatementProductName({ ProdName: 'ROSE CHINA / 프라우드 (White proud) 75-80cm' }) === '프라우드 (White proud)');
  assert('Momentum', getStatementProductName({ ProdName: 'ROSE / Momentum 50cm' }) === 'Momentum');
  assert('rose / 소문자', getStatementProductName({ ProdName: 'rose / lavender 60cm' }) === 'lavender');
  assert('HYDRANGEA 접두', getStatementProductName({ ProdName: 'HYDRANGEA fifi 50cm' }) === 'fifi');
  assert('콜롬비아 수국 혼합', getStatementProductName({ ProdName: '콜롬비아 수국 HYDRANGEA Blue (블루)' }) === 'Blue (블루)');

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

  console.log('\n=== prepareEstimatePrintRows (인쇄 비고 합산) ===');
  const mergeRows = [
    { EstimateType: '정상출고', ProdKey: 1, ProdName: 'ROSE', Unit: '송이', Cost: 700, outDate: '2026-06-04', Quantity: 10, Amount: 6364, Vat: 636, BoxQty: 1, DescrRaw: '임16>12', Descr: '' },
    { EstimateType: '정상출고', ProdKey: 1, ProdName: 'ROSE', Unit: '송이', Cost: 700, outDate: '2026-06-04', Quantity: 20, Amount: 12727, Vat: 1273, BoxQty: 2, DescrRaw: '특별요청', Descr: '특별요청' },
  ];
  const merged = prepareEstimatePrintRows(mergeRows, {});
  assert('동일 품목 합산 1행', merged.rows.length === 1);
  assert('합산 후 비고는 화면과 동일', merged.descLabel(merged.rows[0]) === '특별요청');

  const deductMerged = prepareEstimatePrintRows([
    { EstimateKey: 1, EstimateType: '단가차감/단', ProdKey: 9, ProdName: 'ROSE', Unit: '단', Cost: 100, outDate: '2026-06-04', Quantity: -1, Amount: -91, Vat: -9, DescrRaw: '25년도 불량차감 미적용건', Descr: '25년도 불량차감 미적용건' },
  ], { printFormat: 'estimate' });
  assert('단가차감 비고 인쇄', deductMerged.descLabel(deductMerged.rows[0]) === '25년도 불량차감 미적용건');

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
