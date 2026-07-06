/**
 * 이카운트 업로드 Excel 매핑 검증
 * 실행: node __tests__/estimateEcountExcel.test.js
 */
async function main() {
  const { ECOUNT_UPLOAD_HEADERS, mapExcelDetailRowToEcount } = await import('../lib/estimateEcountExcel.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  assert('headers count', ECOUNT_UPLOAD_HEADERS.length === 22);
  assert('EstType default', mapExcelDetailRowToEcount({ EstType: '11' })['거래유형'] === '11');
  assert('maps quantity', mapExcelDetailRowToEcount({ EstQuantity: 10 }).수량 === 10);

  console.log(`\n=== 결과: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
