// 엑셀 업로드 수량 환산·10배 경고 검증
// 실행: node __tests__/shipmentImportQty.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  }
};

async function main() {
  const {
    normalizeUploadQtyForProduct,
    detectQtyWarnings,
    hasCriticalQtyWarnings,
  } = await import('../lib/shipmentImportQty.js');

  const roseBoxProduct = { OutUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 };

  console.log('=== normalizeUploadQtyForProduct (차수피벗 단위 환산) ===');
  {
    const row = { sourceType: 'weekPivot', excelQty: 5, excelUnit: '단', uploadQty: 5 };
    const out = normalizeUploadQtyForProduct(row, roseBoxProduct);
    assert('5단 → 0.5박스 (BunchOf1Box=10)', Math.abs(out - 0.5) < 0.001);
  }

  console.log('\n=== detectQtyWarnings (10배 오류 탐지) ===');
  {
    const bad = detectQtyWarnings(
      { custName: '아이엠', prodName: 'ROSE / Freedom', orderQty: 5, uploadQty: 50, excelQty: 50 },
      roseBoxProduct
    );
    assert('50 vs 5 → critical 경고', bad.some(w => w.severity === 'critical' && w.code === 'SUSPECT_RATIO'));
  }
  {
    const ok = detectQtyWarnings(
      { custName: '아이엠', prodName: 'ROSE / Freedom', orderQty: 5, uploadQty: 5, excelQty: 5 },
      roseBoxProduct
    );
    assert('동일 수량 → critical 없음', !ok.some(w => w.severity === 'critical'));
  }
  {
    const converted = detectQtyWarnings(
      {
        custName: '아이엠',
        prodName: 'ROSE / Freedom',
        orderQty: 0.5,
        uploadQty: 0.5,
        excelQty: 5,
        excelUnit: '단',
      },
      roseBoxProduct
    );
    assert('단→박스 환산 후 일치 → critical 없음', !converted.some(w => w.severity === 'critical'));
  }

  console.log('\n=== hasCriticalQtyWarnings ===');
  assert(
    '집계 플래그',
    hasCriticalQtyWarnings([{ qtyWarnings: [{ severity: 'critical' }] }]) &&
      !hasCriticalQtyWarnings([{ qtyWarnings: [{ severity: 'info' }] }])
  );

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
