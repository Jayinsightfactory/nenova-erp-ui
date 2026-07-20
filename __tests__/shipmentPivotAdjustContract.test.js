const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..');
  const adjust = fs.readFileSync(path.join(root, 'pages/api/shipment/adjust.js'), 'utf8');
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

  console.log('shipment pivot adjustment contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
