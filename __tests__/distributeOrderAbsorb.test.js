// __tests__/distributeOrderAbsorb.test.js
// 출고 분배 미등록 주문 자동 흡수(A→B→A 왕복 제거) 단위 · 계약 · source 정합성 테스트.
// 운영 MSSQL DB 쓰기 금지 — 순수 도메인/모의 API 호출 계약으로만 검증.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ABSORB_ENTRY_MODES,
  buildAbsorbExecutionPlan,
  convertAbsorbQuantity,
  detectOrderRegistrationState,
  executeOrderAbsorbWorkflow,
  filterSameYearOrderRows,
  resolveAbsorbScope,
} from '../lib/distributeOrderAbsorb.js';

const root = process.cwd();

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}: ${err?.stack || err}`);
    process.exitCode = 1;
  }
}

const sampleProductBox = {
  ProdKey: 3513,
  ProdName: '연습 카네이션 Honey',
  OutUnit: '박스',
  EstUnit: '단',
  BunchOf1Box: 10,
  SteamOf1Box: 200,
  SteamOf1Bunch: 20,
  Cost: 11500,
};

const sampleProductBunch = {
  ProdKey: 4201,
  ProdName: '네덜란드 장미 프리덤',
  OutUnit: '단',
  EstUnit: '단',
  BunchOf1Box: 10,
  SteamOf1Box: 200,
  SteamOf1Bunch: 20,
  Cost: 8000,
};

const sampleCustomer = {
  CustKey: 778,
  CustName: '미등록 테스트화원',
  OrderCode: 'T778',
};

await check('1. 교차연도 및 차수 스코프 엄격 검증 (OrderYear 필수·일치)', () => {
  const scope = resolveAbsorbScope({ week: '2026-45-01' });
  assert.equal(scope.orderYear, '2026');
  assert.equal(scope.orderWeek, '45-01');
  assert.equal(scope.orderYearWeek, '20264501');

  assert.throws(() => resolveAbsorbScope({ week: '45-01', year: '' }), (e) => e.code === 'ORDER_YEAR_REQUIRED');
  assert.throws(() => resolveAbsorbScope({ week: '2025-45-01', year: '2026' }), (e) => e.code === 'ORDER_YEAR_MISMATCH');
  assert.throws(() => resolveAbsorbScope({ week: '17-01B', year: '2026' }), (e) => e.code === 'INVALID_ORDER_WEEK');
});

await check('2. 타 연도 동일 차수(2025-45-01) 및 연도 누락 행 필터링 차단', () => {
  const scope = { orderYear: '2026', orderWeek: '45-01' };
  const rows = [
    { CustKey: 778, ProdKey: 3513, OrderYear: '2025', OrderWeek: '45-01', 주문수량: 10, 출고수량: 10 },
    { CustKey: 778, ProdKey: 3513, OrderWeek: '45-01', 주문수량: 5, 출고수량: 5 },
    { CustKey: 778, ProdKey: 3513, OrderYear: '2026', OrderWeek: '45-02', 주문수량: 4, 출고수량: 4 },
    { CustKey: 778, ProdKey: 3513, OrderYear: '2026', OrderWeek: '45-01', 주문수량: 3, 출고수량: 2 },
  ];
  const filtered = filterSameYearOrderRows(rows, scope);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].주문수량, 3);

  const statePriorYearOnly = detectOrderRegistrationState({
    scope,
    customer: sampleCustomer,
    product: sampleProductBox,
    orderRows: [rows[0]],
    shipmentRows: [rows[0]],
  });
  assert.equal(statePriorYearOnly.hasActiveOrder, false);
  assert.equal(statePriorYearOnly.requiresPrecedingOrder, true);
  assert.equal(statePriorYearOnly.currentOrderQty, 0);
  assert.equal(statePriorYearOnly.currentOutQty, 0);
});

await check('3. OutUnit 기준 3단위 환산 및 OutQuantity 단일값 불변식 + 명시 0원 보존', () => {
  const convFinal = convertAbsorbQuantity({
    inputQty: 15,
    inputUnit: '단',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    currentOutQty: 0,
    product: sampleProductBox,
  });
  assert.equal(convFinal.targetOutQty, 1.5);
  assert.equal(convFinal.shipmentUnits.box, 1.5);
  assert.equal(convFinal.shipmentUnits.bunch, 15);
  assert.equal(convFinal.shipmentUnits.steam, 300);
  assert.equal(convFinal.shipmentUnits.outQuantity, 1.5);
  assert.equal(convFinal.shipmentUnits.estQuantity, 15);

  const convDelta = convertAbsorbQuantity({
    inputQty: 200,
    inputUnit: '송이',
    entryMode: ABSORB_ENTRY_MODES.DELTA,
    currentOutQty: 1.5,
    product: sampleProductBox,
  });
  assert.equal(convDelta.inputOutQty, 1);
  assert.equal(convDelta.targetOutQty, 2.5);
  assert.equal(convDelta.shipmentUnits.bunch, 25);

  const convBunchUnit = convertAbsorbQuantity({
    inputQty: 2,
    inputUnit: '박스',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    currentOutQty: 0,
    product: sampleProductBunch,
  });
  assert.equal(convBunchUnit.outUnit, '단');
  assert.equal(convBunchUnit.targetOutQty, 20);
  assert.equal(convBunchUnit.shipmentUnits.box, 2);
  assert.equal(convBunchUnit.shipmentUnits.bunch, 20);
  assert.equal(convBunchUnit.shipmentUnits.outQuantity, 20);

  assert.throws(
    () => convertAbsorbQuantity({
      inputQty: 5,
      inputUnit: '단',
      product: { ...sampleProductBox, BunchOf1Box: 0 },
    }),
    (e) => e.code === 'PRODUCT_UNIT_CONVERSION_MISSING',
  );
  assert.throws(
    () => convertAbsorbQuantity({
      inputQty: 1,
      inputUnit: '박스',
      product: { ...sampleProductBunch, OutUnit: '송이', SteamOf1Box: 0 },
    }),
    (e) => e.code === 'PRODUCT_UNIT_CONVERSION_MISSING',
  );
});

await check('4. 미등록 업체 0수량 가짜주문 차단 · 기존 주문 보존 · 0원 단가 보존', () => {
  const scope = { week: '2026-45-01' };

  assert.throws(
    () => buildAbsorbExecutionPlan({
      scope,
      customer: sampleCustomer,
      product: sampleProductBox,
      orderRows: [],
      inputQty: 0,
      inputUnit: '박스',
      entryMode: ABSORB_ENTRY_MODES.FINAL,
    }),
    (e) => e.code === 'ZERO_ORDER_FORBIDDEN',
  );

  // 미등록 양수 입력 시 manual-order + distribution-workspace 동시 계획 생성
  const absorbPlan = buildAbsorbExecutionPlan({
    scope,
    customer: sampleCustomer,
    product: sampleProductBunch,
    orderRows: [],
    inputQty: 2,
    inputUnit: '박스',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    unitCost: 0, // 명시적 0원
    confirmGatePassed: true,
  });
  assert.equal(absorbPlan.requiresPrecedingOrder, true);
  assert.equal(absorbPlan.orderPayload.source, 'manual-order');
  assert.equal(absorbPlan.orderPayload.year, '2026');
  assert.equal(absorbPlan.orderPayload.week, '45-01');
  assert.deepEqual(absorbPlan.orderPayload.items[0], {
    prodKey: 4201,
    prodName: '네덜란드 장미 프리덤',
    qty: 20,
    unit: '단',
  });
  assert.equal(absorbPlan.distributePayload.source, 'distribution-workspace');
  assert.equal(absorbPlan.distributePayload.entries[0].outQty, 20);
  assert.equal(absorbPlan.distributePayload.entries[0].cost, 0);
  assert.deepEqual(absorbPlan.distributePayload.entries[0].expected, { outQty: 0, cost: 8000 });

  // 기존 활성 주문 존재 시 orderPayload = null, 출고수량 0 초기화 허용, 명시적 0원 기준 유지
  const existingOrderRows = [
    { OrderYear: '2026', OrderWeek: '45-01', CustKey: 778, ProdKey: 4201, 주문수량: 20, 출고수량: 10, SdetailKey: 901, Cost: 0 },
  ];
  const existingPlan = buildAbsorbExecutionPlan({
    scope,
    customer: sampleCustomer,
    product: sampleProductBunch,
    orderRows: existingOrderRows,
    shipmentRows: [{ OrderYear: '2026', OrderWeek: '45-01', CustKey: 778, ProdKey: 4201, SdetailKey: 901, curOut: 10, curCost: 0 }],
    inputQty: 0,
    inputUnit: '단',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    unitCost: 0,
  });
  assert.equal(existingPlan.requiresPrecedingOrder, false);
  assert.equal(existingPlan.orderPayload, null);
  assert.equal(existingPlan.distributePayload.entries[0].outQty, 0);
  assert.deepEqual(existingPlan.distributePayload.entries[0].expected, { outQty: 10, cost: 0 });
});

await check('5. 확인 게이트 · 동시성 선행조회 충돌 · 1단계 실패 시 2단계 즉시 중단 검증', async () => {
  const scope = { week: '2026-45-01' };
  const unconfirmedPlan = buildAbsorbExecutionPlan({
    scope,
    customer: sampleCustomer,
    product: sampleProductBox,
    orderRows: [],
    inputQty: 5,
    inputUnit: '단',
    confirmGatePassed: false,
  });

  let orderCalls = 0;
  let distCalls = 0;
  await assert.rejects(
    () => executeOrderAbsorbWorkflow(unconfirmedPlan, {
      requestOrder: async () => { orderCalls += 1; return { success: true, verified: true }; },
      requestDistribute: async () => { distCalls += 1; return { success: true, verified: true }; },
    }),
    (e) => e.code === 'ORDER_ABSORB_CONFIRM_REQUIRED',
  );
  assert.equal(orderCalls, 0);
  assert.equal(distCalls, 0);

  const confirmedPlan = { ...unconfirmedPlan, confirmGatePassed: true };

  // 실행 직전 재조회 시 타 세션에서 이미 주문이 등록된 경우 즉시 중단
  await assert.rejects(
    () => executeOrderAbsorbWorkflow(confirmedPlan, {
      refreshBeforeWrite: async () => ({
        orderRows: [{ OrderYear: '2026', OrderWeek: '45-01', CustKey: 778, ProdKey: 3513, 주문수량: 2, 출고수량: 0 }],
        shipmentRows: [],
      }),
      requestOrder: async () => { orderCalls += 1; return { success: true, verified: true }; },
      requestDistribute: async () => { distCalls += 1; return { success: true, verified: true }; },
    }),
    (e) => e.code === 'ORDER_ALREADY_REGISTERED_CONFLICT',
  );
  assert.equal(orderCalls, 0);
  assert.equal(distCalls, 0);

  // Step 1 주문등록 실패 또는 verified=false → Step 2 출고분배 절대 미호출
  await assert.rejects(
    () => executeOrderAbsorbWorkflow(confirmedPlan, {
      requestOrder: async () => { orderCalls += 1; return { success: false, error: 'ORDER_SHIPMENT_HEADER_CONFLICT' }; },
      requestDistribute: async () => { distCalls += 1; return { success: true, verified: true }; },
    }),
    (e) => e.code === 'STEP1_ORDER_UNVERIFIED' && e.step1Committed === false && e.step2Executed === false,
  );
  assert.equal(orderCalls, 1);
  assert.equal(distCalls, 0);

  orderCalls = 0;
  distCalls = 0;
  await assert.rejects(
    () => executeOrderAbsorbWorkflow(confirmedPlan, {
      requestOrder: async () => { orderCalls += 1; throw new Error('409 ERP_EDIT_LOCKED'); },
      requestDistribute: async () => { distCalls += 1; return { success: true, verified: true }; },
    }),
    (e) => e.code === 'STEP1_ORDER_FAILED' && e.step2Executed === false,
  );
  assert.equal(orderCalls, 1);
  assert.equal(distCalls, 0);

  // Step 1 성공 후 Step 2 실패 시 복구 안내(step1Committed: true)
  orderCalls = 0;
  distCalls = 0;
  await assert.rejects(
    () => executeOrderAbsorbWorkflow(confirmedPlan, {
      requestOrder: async () => { orderCalls += 1; return { success: true, verified: true, orderMasterKey: 8801 }; },
      requestDistribute: async () => { distCalls += 1; throw new Error('DISTRIBUTION_STALE'); },
    }),
    (e) => e.code === 'STEP2_DISTRIBUTE_FAILED_AFTER_ORDER' && e.step1Committed === true && e.step1Result.orderMasterKey === 8801,
  );
  assert.equal(orderCalls, 1);
  assert.equal(distCalls, 1);
});

await check('6. 정상 순차 흡수 및 기존주문 보존 분배 + 확정차수 안전 사이클 검증', async () => {
  const scope = { week: '2026-45-01' };
  const calls = [];

  const absorbPlan = buildAbsorbExecutionPlan({
    scope,
    customer: sampleCustomer,
    product: sampleProductBox,
    orderRows: [],
    inputQty: 15,
    inputUnit: '단',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    confirmGatePassed: true,
  });

  const absorbOutcome = await executeOrderAbsorbWorkflow(absorbPlan, {
    checkFixedScopes: async () => ({ success: true, scopes: [{ prodKey: 3513, fixed: true, countryFlower: '콜롬비아카네이션' }] }),
    confirmFixCycle: async () => true,
    runFixCycle: async ({ weeks, orderYear, countryFlowers, apply }) => {
      calls.push({ kind: 'fix-cycle-start', weeks, orderYear, countryFlowers });
      const res = await apply();
      calls.push({ kind: 'fix-cycle-end' });
      return res;
    },
    requestOrder: async (payload) => {
      calls.push({ kind: 'order', payload });
      return { success: true, verified: true, orderMasterKey: 9901, shipmentMasterKey: 7701, results: [{ prodKey: 3513, status: 'OK' }] };
    },
    requestDistribute: async (payload) => {
      calls.push({ kind: 'distribute', payload });
      return { success: true, verified: true, savedCount: 1 };
    },
    refreshAfter: async () => {
      calls.push({ kind: 'refresh' });
      return { ok: true };
    },
  });
  assert.equal(absorbOutcome.success, true);
  assert.equal(absorbOutcome.orderCreated, true);
  assert.equal(absorbOutcome.fixCycleUsed, true);
  assert.deepEqual(
    calls.map((c) => c.kind),
    ['fix-cycle-start', 'order', 'distribute', 'fix-cycle-end', 'refresh'],
  );

  // 기존 활성 주문 존재 시 requestOrder 미호출
  const preservePlan = buildAbsorbExecutionPlan({
    scope,
    customer: sampleCustomer,
    product: sampleProductBox,
    orderRows: [{ OrderYear: '2026', OrderWeek: '45-01', CustKey: 778, ProdKey: 3513, 주문수량: 3, 출고수량: 1.5, Cost: 11500, SdetailKey: 55 }],
    inputQty: 2.5,
    inputUnit: '박스',
    entryMode: ABSORB_ENTRY_MODES.FINAL,
    confirmGatePassed: false,
  });
  let orderInvoked = 0;
  let distInvoked = 0;
  const preserveOutcome = await executeOrderAbsorbWorkflow(preservePlan, {
    requestOrder: async () => { orderInvoked += 1; return { success: true, verified: true }; },
    requestDistribute: async (payload) => {
      distInvoked += 1;
      assert.equal(payload.entries[0].outQty, 2.5);
      return { success: true, verified: true, savedCount: 1 };
    },
  });
  assert.equal(preserveOutcome.orderPreserved, true);
  assert.equal(preserveOutcome.orderCreated, false);
  assert.equal(orderInvoked, 0);
  assert.equal(distInvoked, 1);
});

await check('7. UI 페이지 / Layout / Desktop 메뉴 / 기존 distribute.js 해시 계약 확인', () => {
  const quickPage = fs.readFileSync(path.join(root, 'pages/shipment/quick-absorb.js'), 'utf8');
  assert.ok(!/import\s+Layout\s+from/.test(quickPage), 'quick-absorb.js must not import Layout directly');
  assert.ok(!/<Layout(?:\s|>)/.test(quickPage), 'quick-absorb.js must not render <Layout>');
  assert.ok(quickPage.includes('workflowId="shipment-quick-absorb"'), 'WorkflowGuide must be embedded');
  assert.ok(quickPage.includes('/api/orders'), 'quick-absorb.js must reuse /api/orders');
  assert.ok(quickPage.includes('/api/shipment/distribute'), 'quick-absorb.js must reuse /api/shipment/distribute');

  const layout = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
  assert.ok(layout.includes("href: '/shipment/quick-absorb'"), 'Layout.js MENU_ITEMS must include /shipment/quick-absorb');

  const desktopMenu = JSON.parse(fs.readFileSync(path.join(root, 'desktop/menu.json'), 'utf8'));
  const shipmentGroup = desktopMenu.find((g) => g.group === '입/출고관리');
  assert.ok(shipmentGroup?.items.some((item) => item.href === '/shipment/quick-absorb'), 'desktop/menu.json must include /shipment/quick-absorb');
});

console.log(`\ndistributeOrderAbsorb tests complete: ${passed} passed`);
