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
    assert('ROSE_ALLOC_CONVERTED info', converted.some(w => w.code === 'BUNCH_ALLOC_CONVERTED'));
  }

  console.log('\n=== 카네이션 물량표 단→박스 (BunchOf1Box=15) ===');
  {
    const carnationProduct = { OutUnit: '박스', BunchOf1Box: 15, SteamOf1Box: 0 };
    const row = { sheetName: '2301카네', productFamily: 'carnation', excelQty: 45, uploadQty: 45 };
    const out = normalizeUploadQtyForProduct(row, carnationProduct);
    assert('45단 → 3박스', Math.abs(out - 3) < 0.001);
  }

  console.log('\n=== 콜롬비아카네이션 물량표 — 박스 그대로 ===');
  {
    const { isBoxAllocationImportSheet } = await import('../lib/shipmentImportQty.js');
    const carnationProduct = { OutUnit: '박스', BunchOf1Box: 15, CountryFlower: '콜롬비아카네이션' };
    const row = {
      sheetName: '콜롬비아카네이션',
      productFamily: 'carnation',
      excelQty: 1,
      uploadQty: 1,
      orderQty: 1,
      currentOutQty: 1,
    };
    assert('sheet 감지', isBoxAllocationImportSheet(row, carnationProduct));
    const out = normalizeUploadQtyForProduct(row, carnationProduct);
    assert('1박스 유지 (1/15 오류 없음)', Math.abs(out - 1) < 0.001);
    const warns = detectQtyWarnings({ ...row, uploadQty: out, excelQty: 1 }, carnationProduct);
    assert('수량경고 없음', !warns.some(w => w.severity === 'critical'));
  }

  console.log('\n=== 장미: 주문=5박스 엑셀=5 → 박스 (단 50 아님) ===');
  {
    const row = {
      sheetName: '2301장미',
      productFamily: 'rose',
      excelQty: 5,
      uploadQty: 5,
      orderQty: 5,
      currentOutQty: 5,
    };
    const out = normalizeUploadQtyForProduct(row, roseBoxProduct);
    assert('5박스 유지', Math.abs(out - 5) < 0.001);
  }

  console.log('\n=== distributeUnits OutUnit 기준 (출고분배·재고 PATCH) ===');
  {
    const { distributeUnits } = await import('../lib/distributeUnits.js');
    const rose = { OutUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100, EstUnit: '박스' };
    const bunchProd = { OutUnit: '단', BunchOf1Box: 10, SteamOf1Bunch: 0, EstUnit: '단' };
    assert('박스 5', distributeUnits(5, rose).outQty === 5 && distributeUnits(5, rose).box === 5);
    assert('단 10 → outQty 10', distributeUnits(10, bunchProd).outQty === 10);
    assert('단 10 → box 1', Math.abs(distributeUnits(10, bunchProd).box - 1) < 0.001);
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

  console.log('\n=== isImportRowInUploadScope (28-01 콜롬비아카네이션 품목삭제 유령분배 재현) ===');
  {
    const { isImportRowInUploadScope } = await import('../lib/shipmentImportQty.js');
    // 케이스1: 텍스트 매칭 성공(uploadedProductKeys 에 있음) → 스코프 포함
    assert(
      '텍스트 매칭된 prodKey는 스코프 포함',
      isImportRowInUploadScope(100, 200, new Set([200]), new Set(), new Set())
    );
    // 케이스2: 품목 행 자체를 시트에서 통째로 삭제 — 텍스트 매칭 실패(uploadedProductKeys 없음)이지만
    // _keymap 은 export 시점 전체 범위를 담고 있어 custKeysInScope/prodKeysInScope 로 커버돼야 한다.
    assert(
      '행 삭제로 텍스트매칭 실패해도 키맵 스코프(cust+prod 모두)에 있으면 포함 — 유령분배 방지',
      isImportRowInUploadScope(100, 200, new Set(), new Set([100]), new Set([200]))
    );
    // 케이스3: 키맵 스코프에도 없고 텍스트 매칭도 안 됨(이 워크북과 무관한 기존 DB 라인) → 제외(기존 분배 보존)
    assert(
      '스코프 밖(다른 거래처 기존 분배)은 제외 — 무관한 기존 값 보존',
      !isImportRowInUploadScope(999, 888, new Set(), new Set([100]), new Set([200]))
    );
    // 케이스4: 품목은 스코프에 있는데 거래처가 다른 워크북 범위 — 교집합 없으면 제외(오삭제 방지)
    assert(
      'prodKey 는 스코프에 있어도 custKey 가 없으면 제외',
      !isImportRowInUploadScope(999, 200, new Set(), new Set([100]), new Set([200]))
    );
  }

  console.log('\n=== dedupeVerifyTargets + compareVerifyResult (사후 검증 — 출고일/요일 중복열 합산) ===');
  {
    const { dedupeVerifyTargets, compareVerifyResult } = await import('../lib/shipmentImportQty.js');

    // 정상 케이스: 같은 거래처+품목이 물량표에서 화/목 등 다른 출고일(요일) 열로 나뉘어
    // apply 대상 목록에 동일 (custKey,prodKey) 로 두 번 들어온다(정상 — 파서가 합산해서 반영).
    // DB 에는 그 합계(30)가 이미 정상 반영돼 있다 → dedupe 후 비교하면 불일치 0건이어야 한다.
    const dupTargets = [
      { custKey: 10, prodKey: 100, custName: '수연원예', prodName: 'Carnation Red', intended: 12 },  // 화요일 열
      { custKey: 10, prodKey: 100, custName: '수연원예', prodName: 'Carnation Red', intended: 18 },  // 목요일 열
    ];
    const deduped = dedupeVerifyTargets(dupTargets);
    assert('dedupe 후 (custKey,prodKey) 유일 1건', deduped.length === 1);
    assert('dedupe intended 합산 = 30(12+18)', Math.abs(deduped[0].intended - 30) < 0.001);

    const actualOk = new Map([
      ['10|100', { outQuantity: 30, dateQty: 30, dateIssueCount: 0 }],
    ]);
    const okResult = compareVerifyResult(deduped, actualOk);
    assert('중복 출고일 열 합산 정상 케이스 → 불일치 0건', okResult.mismatchCount === 0);
    assert('정상 케이스 → 매칭 1건', okResult.matched === 1);

    // 만약 합산하지 않고(버그) 마지막 열 값(18)만 비교했다면 30≠18 로 오탐(false mismatch)했을 것 —
    // 합산 없이 비교하면 실제로 불일치가 나는지 대조 확인(회귀 방지용 네거티브 체크).
    const undeduped = compareVerifyResult([dupTargets[1]], actualOk);
    assert('합산 안 하면(마지막 열만) 오탐 발생 — dedupe 가 왜 필요한지 대조', undeduped.mismatchCount === 1);

    // 실제 미반영 케이스: intended=30 인데 DB 실제 합계가 0(트랜잭션은 커밋됐지만 조용히 반영 안 됨) → 불일치 1건.
    const actualMissing = new Map([
      ['10|100', { outQuantity: 0, dateQty: 0, dateIssueCount: 0 }],
    ]);
    const missResult = compareVerifyResult(deduped, actualMissing);
    assert('실제 미반영(DB=0) → 불일치 1건', missResult.mismatchCount === 1);
    assert('미반영 사유=분배수량 불일치', missResult.mismatches[0].reason === '분배수량 불일치');
    assert('미반영 intended/actual 기록', missResult.mismatches[0].intended === 30 && missResult.mismatches[0].actual === 0);

    // 삭제 대상(intended=0)이 DB 에서도 실제로 0/없음이면 정상.
    const deleteTarget = [{ custKey: 20, prodKey: 200, custName: '그린화원', prodName: 'Carnation White', intended: 0 }];
    const actualDeleted = new Map([['20|200', { outQuantity: 0, dateQty: 0, dateIssueCount: 0 }]]);
    assert('삭제대상(intended=0) DB도 0 → 불일치 없음', compareVerifyResult(deleteTarget, actualDeleted).mismatchCount === 0);

    // 삭제 대상인데 DB 에 유령 분배가 남아있으면(회귀) 불일치로 잡아야 한다.
    const actualGhost = new Map([['20|200', { outQuantity: 5, dateQty: 5, dateIssueCount: 0 }]]);
    assert('삭제대상인데 DB 에 유령 분배 잔존 → 불일치 1건', compareVerifyResult(deleteTarget, actualGhost).mismatchCount === 1);

    // 출고일(ShipmentDate) 합계 불일치 — 1 Detail + N Date 불변식 위반(sum(ShipmentDate)≠OutQuantity).
    const dateIssueTarget = [{ custKey: 30, prodKey: 300, custName: '꽃길', prodName: 'Carnation Pink', intended: 20 }];
    const actualDateIssue = new Map([['30|300', { outQuantity: 20, dateQty: 12, dateIssueCount: 0 }]]);
    const dateIssueResult = compareVerifyResult(dateIssueTarget, actualDateIssue);
    assert('OutQuantity=20 인데 ShipmentDate 합계=12 → 불일치(출고일 합계 문제)', dateIssueResult.mismatchCount === 1);
    assert('사유=출고일 합계 불일치', dateIssueResult.mismatches[0].reason === '출고일(ShipmentDate) 합계 불일치');

    // 스코프 한정: 이번 apply 와 무관한 (custKey,prodKey) 는 targets 에 없으면 애초에 비교 대상이 아니다.
    const scoped = compareVerifyResult(deduped, new Map([
      ['10|100', { outQuantity: 30, dateQty: 30, dateIssueCount: 0 }],
      ['999|888', { outQuantity: 999, dateQty: 1, dateIssueCount: 5 }],  // 무관한 기존 분배 — targets 에 없으므로 무시돼야 함
    ]));
    assert('targets 에 없는 (custKey,prodKey) 는 checked/mismatch 에 영향 없음', scoped.checked === 1 && scoped.mismatchCount === 0);
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
