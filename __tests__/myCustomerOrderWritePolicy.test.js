const assert = require('node:assert/strict');

(async () => {
  const {
    MY_CUSTOMER_ORDER_MODE,
    assertMyCustomerExpectedCurrentQty,
    validateMyCustomerOrderWriteRequest,
    planMyCustomerOrderWrite,
  } = await import('../lib/myCustomerOrderWritePolicy.js');

  const validAdd = validateMyCustomerOrderWriteRequest({
    source: 'my-customer',
    items: [{ prodKey: 53, qty: '2', expectedCurrentQty: 32 }],
  });
  assert.equal(validAdd.orderMode, MY_CUSTOMER_ORDER_MODE.ADD, 'my-customer의 생략 모드는 ADD여야 한다.');
  assert.equal(validateMyCustomerOrderWriteRequest({ source: 'my-customer', orderMode: 'ADD', items: [{ prodKey: 2, qty: 1, expectedCurrentQty: 0 }] }).orderMode, 'ADD');
  assert.equal(validateMyCustomerOrderWriteRequest({ source: 'sales-paste', orderMode: 'ADD', items: [{ prodKey: 2, qty: 1, expectedCurrentQty: 0 }] }).isMyCustomerSource, true, '영업부 붙여넣기도 주문전용 optimistic-lock 정책을 사용해야 합니다.');
  assert.deepEqual(planMyCustomerOrderWrite({ ...validAdd.items[0], orderMode: validAdd.orderMode, inputOutQty: 2, previousQty: 32, hasActiveOrderDetail: true }), {
    action: 'UPDATE', previousQty: 32, inputQty: 2, deltaQty: 2, finalQty: 34,
  });

  const replacement = validateMyCustomerOrderWriteRequest({
    source: 'my-customer', orderMode: 'replace',
    items: [{ prodKey: 53, qty: 20, expectedCurrentQty: 32 }],
  });
  assert.equal(replacement.orderMode, MY_CUSTOMER_ORDER_MODE.REPLACE);
  assert.deepEqual(planMyCustomerOrderWrite({ orderMode: replacement.orderMode, inputOutQty: 20, previousQty: 32, hasActiveOrderDetail: true }), {
    action: 'UPDATE', previousQty: 32, inputQty: 20, deltaQty: -12, finalQty: 20,
  });

  assert.deepEqual(planMyCustomerOrderWrite({ orderMode: 'REPLACE', inputOutQty: 0, previousQty: 0, hasActiveOrderDetail: false, hasShipmentDetail: false }), {
    action: 'SKIP_ZERO', previousQty: 0, inputQty: 0, deltaQty: 0, finalQty: 0,
  }, '0은 기존 활성 주문이 없으면 ghost 주문을 만들지 않아야 한다.');
  assert.deepEqual(planMyCustomerOrderWrite({ orderMode: 'REPLACE', inputOutQty: 0, previousQty: 3, hasActiveOrderDetail: true, hasShipmentDetail: false }), {
    action: 'DELETE_ZERO', previousQty: 3, inputQty: 0, deltaQty: -3, finalQty: 0,
  });

  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', items: [{ prodKey: 1, qty: '', expectedCurrentQty: 0 }] }), /빈 값/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', orderMode: false, items: [{ prodKey: 1, qty: 1, expectedCurrentQty: 0 }] }), /ADD 또는 REPLACE/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', items: [{ prodKey: 1, qty: true, expectedCurrentQty: 0 }] }), /숫자 또는 숫자 문자열/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', items: [{ prodKey: 1, qty: 1, expectedCurrentQty: [] }] }), /숫자 또는 숫자 문자열/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', items: [{ prodKey: 1, qty: 0, expectedCurrentQty: 0 }] }), /0보다 커야/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', orderMode: 'REPLACE', items: [{ prodKey: 1, qty: -1, expectedCurrentQty: 0 }] }), /0 이상/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'my-customer', items: [{ prodKey: 1, qty: 1, expectedCurrentQty: 0 }, { prodKey: 1, qty: 2, expectedCurrentQty: 0 }] }), /한 번만/);
  assert.throws(() => validateMyCustomerOrderWriteRequest({ source: 'paste', orderMode: 'REPLACE', items: [] }), /내 업체 주문등록/);
  assert.throws(() => planMyCustomerOrderWrite({ orderMode: 'REPLACE', inputOutQty: 0, previousQty: 2, hasActiveOrderDetail: true, hasShipmentDetail: true }), /출고가 있는/);
  assert.throws(() => assertMyCustomerExpectedCurrentQty(2, 3), { code: 'STALE_CURRENT_QTY' });

  console.log('my customer order write policy tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
