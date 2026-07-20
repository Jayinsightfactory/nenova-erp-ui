const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adjust = fs.readFileSync(path.join(root, 'pages/api/shipment/adjust.js'), 'utf8');
const pivot = fs.readFileSync(path.join(root, 'pages/shipment/week-pivot.js'), 'utf8');

assert.match(
  pivot,
  /mode:\s*'SHIPMENT_ONLY'/,
  '차수피벗 셀 편집은 주문+분배 결합 모드가 아니라 분배전용 모드여야 한다.'
);

assert.match(
  adjust,
  /shipmentOnly\s*\?\s*orderQtyBefore/,
  '분배전용 모드에서는 주문수량 전후값이 같아야 한다.'
);

assert.match(
  adjust,
  /SHIPMENT_ONLY_ORDER_MARKER/,
  '주문 없는 업체를 nenova.exe 분배 그리드에 노출할 수량 0 연결행 표식이 필요하다.'
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

assert.match(
  adjust,
  /wm\.OrderYear=@yr AND wm\.OrderWeek=@wk/,
  '입고 합계도 연도로 격리해야 한다.'
);

assert.match(
  adjust,
  /sm\.OrderYear=@yr AND sm\.OrderWeek=@wk/,
  '출고 합계도 연도로 격리해야 한다.'
);

console.log('shipment pivot adjustment contract tests passed');
