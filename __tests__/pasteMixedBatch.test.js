const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    buildPasteMixedActionPreview,
    getPasteMixedBatchStartBlocker,
    orderPasteMixedBatchTargets,
    pasteBatchActionType,
    pasteShipmentLookupProdKeys,
    validatePasteMixedBatchIntent,
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
  assert.deepEqual(
    pasteShipmentLookupProdKeys(
      { items: [{ prodKey: 456 }, { prodKey: 457 }, { prodKey: null }, { prodKey: 999, skip: true }] },
      { items: [{ prodKey: 457 }, { prodKey: 458 }] },
    ),
    [456, 457, 458],
    '현재 분배 조회는 붙여넣은 품목과 기존 주문 품목의 합집합이어야 한다.',
  );
  assert.deepEqual(
    pasteShipmentLookupProdKeys({ items: [{ prodKey: 456 }] }),
    [456],
    '기존 주문이 없는 업체도 붙여넣은 취소 품목의 현재 분배를 조회해야 한다.',
  );

  const cancelOrder = { custMatch: { CustKey: 75, CustName: '남대문 청화' } };
  const addOrder = { custMatch: { CustKey: 401, CustName: '주광농원' } };
  const userExampleEntries = [
    { order: addOrder, item: { action: '추가', inputName: '레드팬서', qty: 10, unit: '단' } },
    { order: cancelOrder, item: { action: '취소', inputName: '레드팬서', qty: 10, unit: '단' } },
  ];
  assert.deepEqual(
    orderPasteMixedBatchTargets(userExampleEntries.map(({ order, item }) => ({ ...item, custName: order.custMatch.CustName })))
      .map(row => `${row.custName}:${pasteBatchActionType(row)}:${row.qty}${row.unit}`),
    ['남대문 청화:CANCEL:10단', '주광농원:ADD:10단'],
    '35-1 레드팬서 변경은 남대문 청화 10단 취소 후 주광농원 10단 추가 순서여야 한다.',
  );
  assert.equal(getPasteMixedBatchStartBlocker({ week: '', entries: userExampleEntries })?.code, 'WEEK_REQUIRED');
  assert.equal(getPasteMixedBatchStartBlocker({ week: '2026-35-01', entries: [] })?.code, 'NO_ACTIONS');
  assert.equal(getPasteMixedBatchStartBlocker({
    week: '2026-35-01', entries: userExampleEntries, presenceByCust: { 75: { loading: true } },
  })?.code, 'PRESENCE_LOADING');
  assert.equal(getPasteMixedBatchStartBlocker({
    week: '2026-35-01', entries: userExampleEntries, presenceByCust: { 75: { active: true, ownedByMe: false, ownerName: '다른 작업자' } },
  })?.code, 'LOCKED');
  assert.equal(getPasteMixedBatchStartBlocker({
    week: '2026-35-01', entries: userExampleEntries, presenceByCust: { 75: { stale: true } },
  })?.code, 'STALE');
  assert.equal(getPasteMixedBatchStartBlocker({
    week: '2026-35-01', entries: userExampleEntries, presenceByCust: { 75: { error: '조회 실패' } },
  })?.code, 'PRESENCE_ERROR');
  assert.equal(getPasteMixedBatchStartBlocker({ week: '2026-35-01', entries: userExampleEntries }), null,
    '정상 2건은 실행 버튼 차단 사유가 없어야 한다.');

  const partialCustomerIntent = validatePasteMixedBatchIntent([
    { id: 1, custName: '로뎀농원', custMatch: { CustKey: 11, CustName: '로뎀농원' }, items: [
      { prodKey: 201, qty: 1, action: '취소', inputName: '돈셀' },
    ] },
    { id: 2, custName: '●영남가빈', custMatch: null, items: [
      { prodKey: 201, qty: 1, action: '추가', inputName: '돈셀' },
    ] },
  ]);
  assert.equal(partialCustomerIntent.intendedCount, 2, '화면의 취소+추가 전체 행 수를 보존해야 한다.');
  assert.equal(partialCustomerIntent.valid, false, '추가 업체가 미확인이면 전체 일괄을 차단해야 한다.');
  assert.equal(partialCustomerIntent.issues.filter((row) => row.reason === 'customer').length, 1,
    '거래처 미확인 행을 저장 대상에서 조용히 제외하면 안 된다.');

  const completeIntent = validatePasteMixedBatchIntent([
    { id: 1, custMatch: { CustKey: 11, CustName: '로뎀농원' }, items: [
      { prodKey: 201, qty: 1, action: '취소', inputName: '돈셀' },
    ] },
    { id: 2, custMatch: { CustKey: 22, CustName: '인터넷공판장 (영남가빈)' }, items: [
      { prodKey: 201, qty: 1, action: '추가', inputName: '돈셀' },
    ] },
  ]);
  assert.equal(completeIntent.valid, true, '거래처·품목·수량이 모두 확인되면 전체 일괄을 허용해야 한다.');

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
  assert.match(pasteSource, /shipmentDiagnostics[\s\S]*전산키 P#[\s\S]*동일품명 실제분배/,
    '취소 미리보기 오류는 선택 원장키와 raw 단위수량 및 동일품명 실제 분배 후보를 실행 전에 표시해야 한다.');
  assert.match(pasteSource, /setCustMatch[\s\S]*pasteShipmentLookupProdKeys\(order, matched\)[\s\S]*pasteShipmentLookupProdKeys\(order\)/,
    '업체 선택 시 기존 주문 유무와 관계없이 붙여넣은 품목까지 현재 분배 조회 대상에 포함해야 한다.');
  assert.match(pasteSource, /setOrders\(applied\);[\s\S]*setPastePresenceByCust\(\{\}\);[\s\S]*setPastePresenceRefreshRevision\(prev => prev \+ 1\)/,
    '명시적 재분석은 같은 업체·차수에서도 이전 STALE 경고를 비우고 최신 서버 지문을 다시 조회해야 한다.');
  assert.match(pasteSource, /pastePresenceRefreshRevision\]\);/,
    '재분석 revision은 작업 상태 조회 effect를 실제로 다시 실행해야 한다.');
  assert.match(adjustSource, /sameNameAlternatives[\s\S]*BoxQuantity[\s\S]*BunchQuantity[\s\S]*SteamQuantity/,
    '현재분배 GET은 자동 재매칭 없이 raw 단위수량과 동일품명 양수 후보를 읽기 전용으로 반환해야 한다.');
  assert.match(adjustSource, /loadShipmentAdjustmentCurrent\(query,[\s\S]*lock: false/,
    '예상값 GET은 공용 현재 분배 조회를 사용해야 한다.');
  assert.match(adjustSource, /loadShipmentAdjustmentCurrent\(tQ,[\s\S]*lock: true/,
    '실제 저장 트랜잭션도 같은 공용 현재 분배 조회를 잠금 모드로 사용해야 한다.');
  assert.match(currentSource, /sm\.OrderYear=@yr AND sm\.OrderWeek=@wk[\s\S]*EXISTS \([\s\S]*sd\.ShipmentKey=sm\.ShipmentKey[\s\S]*sd\.ProdKey=@pk[\s\S]*ISNULL\(sd\.OutQuantity,0\)>0[\s\S]*ISNULL\(sm\.isFix,0\) DESC[\s\S]*sm\.ShipmentKey ASC/,
    '공용 조회는 연도+차수+업체를 고정하고 선택 품목의 실제 양수 분배 마스터를 먼저 사용해야 한다.');
  assert.match(adjustSource, /FROM ShipmentDetail WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*WHERE ShipmentKey=@sk AND ProdKey=@pk[\s\S]*ORDER BY CASE WHEN ISNULL\(OutQuantity,0\)>0 THEN 0 ELSE 1 END[\s\S]*SdetailKey ASC/,
    '실제 저장도 중복 레거시 상세행이 있을 때 0행이 아닌 실제 양수 분배행을 먼저 선택해야 한다.');
  assert.match(adjustSource, /SHIPMENT_CANCEL_EXCEEDS_CURRENT[\s\S]*같은 전산 품명의 다른 분배가 있습니다|같은 전산 품명의 다른 분배가 있습니다[\s\S]*SHIPMENT_CANCEL_EXCEEDS_CURRENT/,
    '취소 대상 품목키가 잘못 매칭되면 같은 전산 품명의 실제 양수 분배 후보와 키를 안내해야 한다.');
  assert.match(
    pasteSource,
    /const targets = orderPasteMixedBatchTargets\(eligibleTargets\);[\s\S]*fetch\('\/api\/shipment\/adjust-batch'/,
    '페이지의 실제 API 실행 배열은 CANCEL→ADD 순서로 만든 뒤 단일 트랜잭션 API에 전달해야 한다.',
  );
  assert.match(pasteSource, /disabled=\{bulkRunning\}[\s\S]*aria-disabled=\{Boolean\(globalBatchStartBlocker\)\}/,
    '실행 중 외의 차단 상태는 클릭을 삼키는 native disabled가 아니라 알림 가능한 aria-disabled여야 한다.');
  assert.match(pasteSource, /alert\(startBlocker\.message\)/,
    '차단된 전체 실행 버튼을 누르면 구체적인 차단 사유를 즉시 알려야 한다.');
  assert.match(pasteSource, /1\/4 차수 확정 상태 확인 중[\s\S]*2\/4 업체별 작업권 확인 중[\s\S]*3\/4 저장 전 취소·추가 전체 검증 중[\s\S]*4\/4 취소 먼저 처리 후 추가·분배 저장 중/,
    '전체 실행은 로그가 비는 구간 없이 현재 처리 단계를 즉시 표시해야 한다.');
  assert.match(pasteSource, /preflightOnly: true[\s\S]*AbortSignal\.timeout\(60_000\)/,
    '저장 전 검증이 무한 대기하지 않도록 읽기·롤백 전용 요청에 제한시간을 둬야 한다.');
  assert.match(
    pasteSource,
    /const intent = validatePasteMixedBatchIntent\(orders\);[\s\S]*if \(!intent\.valid\)[\s\S]*return;[\s\S]*fetch\('\/api\/shipment\/adjust-batch'/,
    '미확인 행이 하나라도 있으면 API 호출 전에 전체 일괄을 차단해야 한다.',
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
