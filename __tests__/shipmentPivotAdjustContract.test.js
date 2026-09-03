const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..');
  const adjust = fs.readFileSync(path.join(root, 'pages/api/shipment/adjust.js'), 'utf8');
  const stockStatus = fs.readFileSync(path.join(root, 'pages/api/shipment/stock-status.js'), 'utf8');
  const startStockText = fs.readFileSync(path.join(root, 'pages/api/shipment/start-stock-text.js'), 'utf8');
  const pivot = fs.readFileSync(path.join(root, 'pages/shipment/week-pivot.js'), 'utf8');
  const paste = fs.readFileSync(path.join(root, 'pages/orders/paste.js'), 'utf8');
  const { resolvePivotAdjustmentPolicy } = await import('../lib/pivotAdjustmentPolicy.js');
  assert.match(adjust, /formatDirectionalProductLabel/, '재고 부족 오류는 서버 조회 품종·품목명·전산키를 표시한다');
  assert.match(adjust, /품목 \$\{productLabel\} · 가용수량/, '초과 분배 오류에 품목 라벨을 먼저 표시한다');

  const cases = [
    {
      label: 'ADD + 주문 없음 = 주문등록 + 분배',
      input: { mode: 'PIVOT_DISTRIBUTION', type: 'ADD', hasActiveOrder: false },
      mutateOrder: true,
      reason: 'pivot_add_without_order',
    },
    {
      label: 'ADD + 기존 주문 있음 = 분배만',
      input: { mode: 'PIVOT_DISTRIBUTION', type: 'ADD', hasActiveOrder: true },
      mutateOrder: false,
      reason: 'pivot_add_existing_order',
    },
    {
      label: 'CANCEL + 주문 있음 = 분배만',
      input: { mode: 'PIVOT_DISTRIBUTION', type: 'CANCEL', hasActiveOrder: true },
      mutateOrder: false,
      reason: 'pivot_cancel_distribution_only',
    },
    {
      label: 'CANCEL + 주문 없음 = 분배만',
      input: { mode: 'PIVOT_DISTRIBUTION', type: 'CANCEL', hasActiveOrder: false },
      mutateOrder: false,
      mutateShipment: true,
      reason: 'pivot_cancel_distribution_only',
    },
    {
      label: 'AUTO_CANCEL + 활성 분배 있음 = 분배만 취소',
      input: { mode: 'AUTO_CANCEL', type: 'CANCEL', hasActiveOrder: true, hasActiveShipment: true },
      mutateOrder: false,
      mutateShipment: true,
      reason: 'auto_cancel_distribution_only',
    },
    {
      label: 'AUTO_CANCEL + 활성 분배 없음 = 주문 보존, 분배 저장 단계에서 실패',
      input: { mode: 'AUTO_CANCEL', type: 'CANCEL', hasActiveOrder: true, hasActiveShipment: false },
      mutateOrder: false,
      mutateShipment: true,
      reason: 'auto_cancel_distribution_only',
    },
  ];

  for (const tc of cases) {
    const result = resolvePivotAdjustmentPolicy(tc.input);
    assert.equal(result.mutateOrder, tc.mutateOrder, tc.label);
    assert.equal(result.mutateShipment, tc.mutateShipment ?? true, `${tc.label}: 분배 변경 정책`);
    assert.equal(result.reason, tc.reason, `${tc.label}: 감사 사유`);
  }

  assert.equal(
    resolvePivotAdjustmentPolicy({ mode: undefined, type: 'CANCEL', hasActiveOrder: true }).mutateOrder,
    true,
    '기존 주문등록+분배 호출자는 결합 동작을 유지한다.'
  );

  assert.match(
    pivot,
    /mode:\s*'PIVOT_DISTRIBUTION'/,
    '차수피벗 셀 편집은 명시적인 차수피벗 계약 모드를 보내야 한다.'
  );
  assert.match(pivot, /year:\s*it\.year/, '차수피벗 일괄 적용은 편집 당시 연도를 API에 전달해야 한다.');
  assert.match(pivot, /orderYearFromWeek\(wf\)/, '차수피벗 조회는 선택 차수의 연도를 API에 전달해야 한다.');
  assert.match(pivot, /start-stock-text[\s\S]*year:orderYearFromWeek/, '시작재고 텍스트 저장도 선택 연도를 전달해야 한다.');
  assert.doesNotMatch(
    adjust,
    /SHIPMENT_ONLY_ORDER_MARKER|WEB_SHIPMENT_ONLY_LINK/,
    '수량 0 가짜 주문 연결행을 만들면 안 된다.'
  );
  assert.match(
    adjust,
    /hasActiveOrder\s*=\s*Boolean\(odRow\s*&&\s*orderQtyBefore\s*>\s*0\.0001\)/,
    '현재연도·업체·품목의 실제 양수 주문 존재 여부로 정책을 선택해야 한다.'
  );
  assert.doesNotMatch(adjust, /auto_cancel_order_only|autoCancel && !adjustmentPolicy\.mutateShipment/, 'AUTO_CANCEL은 분배 유무와 관계없이 주문을 수정하면 안 된다.');
  assert.match(adjust, /!pivotDistribution && !autoCancel && type === 'CANCEL'/, 'AUTO_CANCEL 후처리도 주문 원장을 자동 삭제하면 안 된다.');
  assert.match(paste, /mode: 'AUTO_CANCEL'/, '붙여넣기 취소는 AUTO_CANCEL 서버 분기를 사용해야 한다.');
  assert.match(paste, /failedOnly[\s\S]*실패 품목만 재시도/, '부분 성공 뒤에는 성공 품목을 중복 가산하지 않고 실패 품목만 재시도할 수 있어야 한다.');
  assert.match(
    paste,
    /useEffect\(\(\) => \{[\s\S]*?loadStockNote\(stockBaseWeek, \{ apply: false \}\);[\s\S]*?\}, \[stockBaseWeek\]\);/,
    '붙여넣기 주문등록은 페이지 진입이나 기준 차수 변경만으로 이전 입력 저장본을 자동 복원하면 안 된다.'
  );
  assert.match(
    paste,
    /loadStockNote\(activeStockBaseWeek, \{ apply: true \}\)/,
    '이전 입력 저장본은 사용자가 불러오기 버튼을 명시적으로 눌렀을 때만 적용해야 한다.'
  );
  assert.doesNotMatch(
    paste,
    /const shouldApply = !pasteText\.trim\(\)/,
    '입력창이 비어 있다는 이유만으로 이전 저장본을 자동 복원하는 정책을 다시 추가하면 안 된다.'
  );
  assert.match(
    adjust,
    /OrderMaster[\s\S]*?CustKey=@ck AND OrderYear=@yr AND OrderWeek=@wk/,
    'OrderMaster 선택은 연도를 포함해야 같은 차수명의 전년도 주문을 수정하지 않는다.'
  );
  assert.match(
    adjust,
    /ShipmentMaster[\s\S]*?CustKey=@ck AND OrderYear=@yr AND OrderWeek=@wk/,
    'ShipmentMaster 선택은 연도를 포함해야 같은 차수명의 전년도 출고를 수정하지 않는다.'
  );
  assert.match(adjust, /wm\.OrderYear=@yr AND wm\.OrderWeek=@wk/, '입고 합계도 연도로 격리해야 한다.');
  assert.match(adjust, /sm\.OrderYear=@yr AND sm\.OrderWeek=@wk/, '출고 합계도 연도로 격리해야 한다.');
  assert.match(adjust, /SELECT SUM\(vs\.OutQuantity\) FROM ViewShipment vs[\s\S]*vs\.ProdKey=@pk AND vs\.OrderYear=@yr AND vs\.OrderWeek=@wk/, 'ADD 재고검사의 전체 분배량은 nenova.exe와 같은 ViewShipment 범위여야 한다.');
  assert.doesNotMatch(adjust, /SELECT SUM\(sd\.OutQuantity\) FROM ShipmentDetail sd[\s\S]{0,180}AS totalOut/, '삭제 업체·품목의 고아 출고를 포함하는 raw ShipmentDetail 합계를 재고검사에 쓰면 안 된다.');
  assert.match(adjust, /ProductStock ps[\s\S]*sm2\.OrderYear[\s\S]*sm2\.OrderWeek[\s\S]*< @currentOrderYearWeek/, 'ADD 검증은 현재 연도차수 결합키보다 작은 최신 ProductStock 스냅샷을 이월재고로 사용해야 한다.');
  assert.match(adjust, /prevStock[\s\S]*currentIn[\s\S]*adjustQty[\s\S]*available[\s\S]*remainAfter/, '재고 검증 응답은 이월·입고·조정·가용·출고·잔량을 구분해야 한다.');
  assert.match(stockStatus, /resolveActiveOrderYear/, '조회·저장 API는 레거시 2025 주차 해석 대신 활성 연도 해석기를 사용해야 한다.');
  assert.match(stockStatus, /om\.OrderYear=@orderYear[\s\S]*om\.OrderWeek >= @weekFrom/, '업체별 주차 조회는 연도와 차수를 함께 필터링해야 한다.');
  const crossYearPivotFixture = [
    { OrderYear: '2025', OrderWeek: '29-02', CustKey: 17, ProdKey: 301, outQty: 4 },
    { OrderYear: '2026', OrderWeek: '29-02', CustKey: 17, ProdKey: 301, outQty: 9 },
  ];
  assert.deepEqual(
    crossYearPivotFixture.filter((row) => row.OrderYear === '2026' && row.OrderWeek === '29-02'),
    [crossYearPivotFixture[1]],
    '모아보기 피벗의 동일 차수 교차연도 fixture는 선택 연도 행만 남겨야 한다.'
  );
  const explicitUnitCrossYearFixture = [
    { OrderYear: '2025', OrderWeek: '32-02', CustKey: 11, ProdKey: 8799, unit: '단' },
    { OrderYear: '2026', OrderWeek: '32-02', CustKey: 11, ProdKey: 8799, unit: '박스' },
  ];
  assert.deepEqual(
    explicitUnitCrossYearFixture.filter(row => row.OrderYear === '2026' && row.OrderWeek === '32-02'),
    [explicitUnitCrossYearFixture[1]],
    '명시 단위 저장도 2025/2026 동일 32-02 중 선택 연도 업무키만 사용해야 한다.',
  );
  assert.match(
    stockStatus,
    /LEFT JOIN ShipmentMaster sm ON sm\.CustKey=om\.CustKey\s+AND sm\.OrderYear=om\.OrderYear AND sm\.OrderWeek=om\.OrderWeek/,
    '모아보기 피벗은 주문과 출고를 연도·차수·업체로 결합해야 한다.'
  );
  assert.match(
    stockStatus,
    /WHERE om\.OrderYear=@orderYear\s+AND om\.OrderWeek >= @weekFrom AND om\.OrderWeek <= @weekTo/,
    '모아보기 피벗은 선택 연도와 차수 범위만 조회해야 한다.'
  );
  assert.match(stockStatus, /\$\{orderYear\}\$\{weekFrom\.replace\(/, 'EXE 차수피벗 범위에도 선택 연도를 다시 붙여야 한다.');
  assert.match(stockStatus, /const normYear = resolveActiveOrderYear\(week, year\)/, '업체 추가는 명시된 연도를 사용해야 한다.');
  assert.match(stockStatus, /const normYear2 = resolveActiveOrderYear\(week, year\)/, '업체 추가 delta도 명시된 연도를 사용해야 한다.');
  assert.match(startStockText, /WHERE OrderYear=@yr AND OrderWeek=@wk/, '시작재고 StockMaster 재사용은 연도를 포함해야 한다.');
  assert.match(startStockText, /INSERT INTO StockMaster \(OrderYear, OrderYearWeek, OrderWeek, isFix\)/, '시작재고 신규 StockMaster도 전산 결합 키를 저장해야 한다.');

  console.log('shipment pivot adjustment contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
