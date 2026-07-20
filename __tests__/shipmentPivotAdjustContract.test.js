const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..');
  const adjust = fs.readFileSync(path.join(root, 'pages/api/shipment/adjust.js'), 'utf8');
  const stockStatus = fs.readFileSync(path.join(root, 'pages/api/shipment/stock-status.js'), 'utf8');
  const startStockText = fs.readFileSync(path.join(root, 'pages/api/shipment/start-stock-text.js'), 'utf8');
  const pivot = fs.readFileSync(path.join(root, 'pages/shipment/week-pivot.js'), 'utf8');
  const { resolvePivotAdjustmentPolicy } = await import('../lib/pivotAdjustmentPolicy.js');

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
      reason: 'pivot_cancel_distribution_only',
    },
  ];

  for (const tc of cases) {
    const result = resolvePivotAdjustmentPolicy(tc.input);
    assert.equal(result.mutateOrder, tc.mutateOrder, tc.label);
    assert.equal(result.mutateShipment, true, `${tc.label}: 분배 변경은 항상 수행`);
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
  assert.match(stockStatus, /resolveActiveOrderYear/, '조회·저장 API는 레거시 2025 주차 해석 대신 활성 연도 해석기를 사용해야 한다.');
  assert.match(stockStatus, /om\.OrderYear=@orderYear[\s\S]*om\.OrderWeek >= @weekFrom/, '업체별 주차 조회는 연도와 차수를 함께 필터링해야 한다.');
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
