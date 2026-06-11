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

  console.log('\n=== 장미 물량표(업체별 열) 단→박스 자동 환산 ===');
  {
    const row = {
      sheetName: '2301장미',
      productFamily: 'rose',
      productLabel: 'Freedom 50',
      excelQty: 50,
      uploadQty: 50,
    };
    const out = normalizeUploadQtyForProduct(row, roseBoxProduct);
    assert('50단 물량표 → 5박스', Math.abs(out - 5) < 0.001);
  }
  {
    const pivot = normalizeUploadQtyForProduct(
      { sourceType: 'weekPivot', productFamily: 'rose', excelQty: 50, uploadQty: 50 },
      roseBoxProduct
    );
    assert('차수피벗(단위열 없음)은 장미 자동환산 안 함', Math.abs(pivot - 50) < 0.001);
  }
  {
    const explicitBox = normalizeUploadQtyForProduct(
      { productFamily: 'rose', excelQty: 5, excelUnit: '박스', uploadQty: 5 },
      roseBoxProduct
    );
    assert('단위열=박스면 그대로', Math.abs(explicitBox - 5) < 0.001);
  }
  {
    const converted = detectQtyWarnings(
      {
        productFamily: 'rose',
        sheetName: '2301장미',
        orderQty: 5,
        uploadQty: 5,
        excelQty: 50,
      },
      roseBoxProduct
    );
    assert('환산 후 주문과 일치 → critical 없음', !converted.some(w => w.severity === 'critical'));
    assert('ROSE_ALLOC_CONVERTED info', converted.some(w => w.code === 'ROSE_ALLOC_CONVERTED'));
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

  console.log('\n=== DB 이미 10배 오류 + 엑셀주문수량 기준 ===');
  {
    const reimport = detectQtyWarnings(
      {
        custName: '주광',
        prodName: 'ROSE / Freedom',
        orderQty: 50,
        currentOutQty: 50,
        uploadQty: 50,
        excelQty: 50,
        excelOrderQty: 5,
        sourceType: 'weekPivot',
      },
      roseBoxProduct
    );
    assert(
      'DB=50이어도 엑셀주문 5 vs 출고 50 → critical',
      reimport.some(w => w.severity === 'critical' && w.baselineLabel === '엑셀주문수량')
    );
  }

  console.log('\n=== 단위열 있는데 환산 누락 ===');
  {
    const unitMiss = detectQtyWarnings(
      {
        custName: '주광',
        prodName: 'ROSE / Freedom',
        orderQty: 0,
        uploadQty: 50,
        excelQty: 50,
        excelUnit: '단',
      },
      roseBoxProduct
    );
    assert('50단→50박스 그대로 → UNIT_NOT_CONVERTED', unitMiss.some(w => w.code === 'UNIT_NOT_CONVERTED'));
  }

  console.log('\n=== 동일 품목 다른 업체 대비 (주광 10배) ===');
  {
    const rows = [
      { key: 'a|1', prodKey: 1, custName: 'A', uploadQty: 5, qtyWarnings: [], hasQtyWarning: false },
      { key: 'b|1', prodKey: 1, custName: 'B', uploadQty: 6, qtyWarnings: [], hasQtyWarning: false },
      { key: 'c|1', prodKey: 1, custName: '주광', uploadQty: 50, qtyWarnings: [], hasQtyWarning: false },
    ];
    const { appendPeerQtyWarnings } = await import('../lib/shipmentImportQty.js');
    appendPeerQtyWarnings(rows);
    assert('주광 50 vs peer ~5 → PEER_OUTLIER', rows[2].qtyWarnings.some(w => w.code === 'PEER_OUTLIER'));
  }

  console.log('\n=== 24-01 주광 단독주문: DB·엑셀 모두 10배 (peer 없음) → 같은업체 다른품목 ===');
  {
    // 주광이 그 장미를 단독 주문해 prodKey peer 가 없고, DB 주문/분배·엑셀이 모두 50(10배).
    // 같은 업체의 다른 장미는 5박스대 → 박스당 10단(BunchOf1Box) 비율로 잡아야 한다.
    const { appendCustomerPeerQtyWarnings } = await import('../lib/shipmentImportQty.js');
    const productByKey = new Map([
      [1, { BunchOf1Box: 10, OutUnit: '박스' }],
      [2, { BunchOf1Box: 10, OutUnit: '박스' }],
      [3, { BunchOf1Box: 10, OutUnit: '박스' }],
    ]);
    const rows = [
      { key: '주광|1', custKey: 7, prodKey: 1, custName: '주광', outUnit: '박스', uploadQty: 5, qtyWarnings: [], hasQtyWarning: false },
      { key: '주광|2', custKey: 7, prodKey: 2, custName: '주광', outUnit: '박스', uploadQty: 6, qtyWarnings: [], hasQtyWarning: false },
      { key: '주광|3', custKey: 7, prodKey: 3, custName: '주광', outUnit: '박스', uploadQty: 50, qtyWarnings: [], hasQtyWarning: false },
    ];
    appendCustomerPeerQtyWarnings(rows, productByKey);
    assert('주광 장미 50 vs 다른품목 ~5 → CUST_PEER_BUNCH', rows[2].qtyWarnings.some(w => w.code === 'CUST_PEER_BUNCH'));
    assert('정상 5박스 행은 경고 없음', !rows[0].hasQtyWarning && !rows[1].hasQtyWarning);
  }
  {
    // 오탐 방지: 비율이 BunchOf1Box(10)와 안 맞으면(큰 단독 주문일 수 있음) 경고 없음.
    const { appendCustomerPeerQtyWarnings } = await import('../lib/shipmentImportQty.js');
    const productByKey = new Map([
      [1, { BunchOf1Box: 10, OutUnit: '박스' }],
      [2, { BunchOf1Box: 10, OutUnit: '박스' }],
      [3, { BunchOf1Box: 10, OutUnit: '박스' }],
    ]);
    const rows = [
      { key: '주광|1', custKey: 7, prodKey: 1, custName: '주광', outUnit: '박스', uploadQty: 8, qtyWarnings: [], hasQtyWarning: false },
      { key: '주광|2', custKey: 7, prodKey: 2, custName: '주광', outUnit: '박스', uploadQty: 8, qtyWarnings: [], hasQtyWarning: false },
      { key: '주광|3', custKey: 7, prodKey: 3, custName: '주광', outUnit: '박스', uploadQty: 50, qtyWarnings: [], hasQtyWarning: false },
    ];
    appendCustomerPeerQtyWarnings(rows, productByKey);
    assert('비율 6.25배(≠10) → 경고 없음 (오탐 방지)', !rows[2].hasQtyWarning);
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
