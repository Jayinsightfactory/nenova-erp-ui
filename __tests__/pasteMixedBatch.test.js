const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    buildPasteMixedActionPreview,
    orderPasteMixedBatchTargets,
    pasteBatchActionType,
  } = await import('../lib/pasteMixedBatch.js');

  const mixed = [
    { prodKey: 101, action: '추가', inputName: '추가 A' },
    { prodKey: 201, action: '취소', inputName: '취소 A' },
    { prodKey: 102, action: '추가', inputName: '추가 B' },
    { prodKey: 202, action: '취소', inputName: '취소 B' },
  ];
  const ordered = orderPasteMixedBatchTargets(mixed);

  assert.deepEqual(
    ordered.map((item) => item.inputName),
    ['취소 A', '취소 B', '추가 A', '추가 B'],
    '혼합 붙여넣기는 CANCEL 전체를 입력순서대로 처리한 뒤 ADD 전체를 입력순서대로 처리해야 한다.',
  );
  assert.deepEqual(
    buildPasteMixedActionPreview({ type: 'CANCEL', qty: 2, unit: '단', orderQty: 10, shipmentQty: 0, product: { OutUnit: '단' } }),
    {
      orderBefore: 10,
      orderAfter: 10,
      shipmentBefore: 0,
      shipmentAfter: 0,
      policy: 'CANCEL_BLOCKED_NO_SHIPMENT',
      error: '취소할 현재 분배가 없어 일괄 처리 시 전체 롤백됩니다.',
    },
    '분배 0 취소는 주문 감소로 예상하지 않고 실제 AUTO_CANCEL처럼 전체 롤백 오류를 표시해야 한다.',
  );
  assert.deepEqual(
    ordered.map(pasteBatchActionType),
    ['CANCEL', 'CANCEL', 'ADD', 'ADD'],
    '실제 실행 배열은 CANCEL 단계와 ADD 단계가 섞이면 안 된다.',
  );
  assert.deepEqual(orderPasteMixedBatchTargets([]), [], '빈 일괄 요청은 그대로 비어 있어야 한다.');

  const product = { OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 };
  assert.deepEqual(
    buildPasteMixedActionPreview({ type: 'CANCEL', qty: 2, unit: '박스', orderQty: 7, shipmentQty: 3, product }),
    { orderBefore: 7, orderAfter: 7, shipmentBefore: 3, shipmentAfter: 1, policy: 'CANCEL_SHIPMENT_ONLY' },
    '활성 분배 취소 예상은 주문 보존·분배 감소여야 한다.',
  );
  assert.deepEqual(
    buildPasteMixedActionPreview({ type: 'ADD', qty: 2, unit: '박스', orderQty: 0, shipmentQty: 0, product }),
    { orderBefore: 0, orderAfter: 2, shipmentBefore: 0, shipmentAfter: 2, policy: 'ADD_ORDER_AND_SHIPMENT' },
    '추가 예상은 주문과 분배가 함께 증가해야 한다.',
  );

  const crossYearFixture = [
    { orderYear: '2025', orderWeek: '33-02', prodKey: 201, action: '취소' },
    { orderYear: '2026', orderWeek: '33-02', prodKey: 201, action: '취소' },
    { orderYear: '2026', orderWeek: '33-02', prodKey: 101, action: '추가' },
  ];
  const selectedYearTargets = orderPasteMixedBatchTargets(
    crossYearFixture.filter((item) => item.orderYear === '2026'),
  );
  assert.deepEqual(
    selectedYearTargets.map((item) => `${item.orderYear}:${pasteBatchActionType(item)}`),
    ['2026:CANCEL', '2026:ADD'],
    '동일 차수 교차연도 fixture는 선택 연도 안에서만 CANCEL→ADD 순서를 적용해야 한다.',
  );

  const pasteSource = fs.readFileSync(path.join(__dirname, '..', 'pages/orders/paste.js'), 'utf8');
  const adjustSource = fs.readFileSync(path.join(__dirname, '..', 'pages/api/shipment/adjust.js'), 'utf8');
  const currentSource = fs.readFileSync(path.join(__dirname, '..', 'lib/shipmentAdjustmentCurrent.js'), 'utf8');
  assert.match(pasteSource, /\/api\/shipment\/adjust\?type=current/,
    '화면 예상값은 주문목록용 custItems가 아니라 실제 adjust 마스터 선택 조회를 사용해야 한다.');
  assert.match(adjustSource, /loadShipmentAdjustmentCurrent\(query,[\s\S]*lock: false/,
    '예상값 GET은 공용 현재 분배 조회를 사용해야 한다.');
  assert.match(adjustSource, /loadShipmentAdjustmentCurrent\(tQ,[\s\S]*lock: true/,
    '실제 저장 트랜잭션도 같은 공용 현재 분배 조회를 잠금 모드로 사용해야 한다.');
  assert.match(currentSource, /OrderYear=@yr AND OrderWeek=@wk[\s\S]*ORDER BY ISNULL\(isFix,0\) DESC, ShipmentKey ASC/,
    '공용 조회는 연도+차수+업체를 고정하고 실제 저장과 같은 마스터 우선순위를 사용해야 한다.');
  assert.match(adjustSource, /FROM ShipmentDetail WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*WHERE ShipmentKey=@sk AND ProdKey=@pk[\s\S]*ORDER BY SdetailKey ASC/,
    '실제 저장도 중복 레거시 상세행이 있을 때 예상값과 같은 첫 상세행을 선택해야 한다.');
  assert.match(
    pasteSource,
    /const targets = orderPasteMixedBatchTargets\(eligibleTargets\);[\s\S]*fetch\('\/api\/shipment\/adjust-batch'/,
    '페이지의 실제 API 실행 배열은 CANCEL→ADD 순서로 만든 뒤 단일 트랜잭션 API에 전달해야 한다.',
  );
  assert.match(
    pasteSource,
    /type: 'CANCEL'[\s\S]*− 취소[\s\S]*type: 'ADD'[\s\S]*\+ 추가/,
    'DB 저장 내역의 단건 조정은 왼쪽 취소, 오른쪽 추가 순서로 표시해야 한다.',
  );

  console.log('paste mixed batch tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
