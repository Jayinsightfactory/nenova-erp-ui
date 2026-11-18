// lib/distributeOrderAbsorb.js
// 출고 분배 시 미등록 업체 주문 자동 흡수(A→B→A 왕복 제거) 순수 도메인/오케스트레이션 모듈.
//
// 원장 계약:
// - 업무키는 항상 OrderYear + OrderWeek + CustKey + ProdKey 4요소.
// - 미등록 업체(!hasActiveOrder)에 양수 분배 시:
//   Step 1) POST /api/orders (source: 'manual-order') → OrderMaster/OrderDetail + 빈 ShipmentMaster 헤더
//   Step 2) POST /api/shipment/distribute (source: 'distribution-workspace') → ShipmentDetail/ShipmentDate + 검증
// - 기존 주문 업체(hasActiveOrder)는 Step 1 을 절대 호출하지 않고 OrderDetail 을 보존한 채 Step 2 만 수행.
// - Step 1 실패 또는 미검증 시 Step 2 를 즉시 중단해 주문 없는 분배/부분 오염을 차단.

import { normalizeOrderUnit, requireOrderYear } from './orderUtils.js';
import { computeShipmentAdjustUnits } from './adjustUnits.js';
import { toOrderUnits } from './shipmentImportQty.js';
import { amountVatFromCostEst } from './distributeUnits.js';
import { distributionFixCycleScope } from './shipmentDistributionWorkspace.js';
import { SHIPMENT_OUT_QTY_EPS, isActiveShipmentOutQty } from './shipmentDetailWriteGuard.js';

export const ABSORB_ENTRY_MODES = Object.freeze({
  FINAL: 'FINAL',
  DELTA: 'DELTA',
});

export const ABSORB_UNIT_OPTIONS = Object.freeze(['박스', '단', '송이']);

export const ABSORB_SIDE_EFFECT_MATRIX = Object.freeze({
  UNREGISTERED_ORDER_ABSORB: Object.freeze({
    orderMaster: 'create-or-reuse-exact-year-week-customer',
    orderDetail: 'create-positive',
    orderHistory: 'create',
    shipmentMaster: 'prepare-empty-if-absent-or-reuse-single-active',
    shipmentDetail: 'increase-or-set-final-after-order-verified',
    shipmentDate: 'sync-from-shipment-detail',
    shipmentFarm: 'preserve',
    warehouse: 'preserve',
    estimate: 'derived-from-shipment-detail',
    stock: 'manual-order-existing-recalculation-only',
  }),
  EXISTING_ORDER_DISTRIBUTE_ONLY: Object.freeze({
    orderMaster: 'preserve',
    orderDetail: 'preserve',
    orderHistory: 'preserve',
    shipmentMaster: 'reuse-or-create-active',
    shipmentDetail: 'set-final-nonnegative',
    shipmentDate: 'sync-or-delete-on-zero',
    shipmentFarm: 'preserve-or-block-delete-when-present',
    warehouse: 'preserve',
    estimate: 'derived-from-shipment-detail',
    stock: 'preserve',
  }),
  STEP1_ORDER_FAILED_ABORT: Object.freeze({
    orderMaster: 'rollback-by-orders-api',
    orderDetail: 'rollback-by-orders-api',
    shipmentMaster: 'rollback-by-orders-api',
    shipmentDetail: 'not-executed',
    shipmentDate: 'not-executed',
    shipmentFarm: 'preserve',
    stock: 'preserve',
  }),
});

function roundQty4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function makeAbsorbError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function parseExplicitNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function extractRowYear(row) {
  const direct = String(row?.OrderYear ?? row?.orderYear ?? row?.year ?? row?._scopedOrderYear ?? '').trim();
  if (/^\d{4}$/.test(direct)) return direct;
  const weekText = String(row?.week ?? row?.OrderWeek ?? row?.orderWeek ?? '').trim();
  const weekMatch = weekText.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (weekMatch) return weekMatch[1];
  const oyw = String(row?.OrderYearWeek ?? row?.orderYearWeek ?? '').trim();
  if (/^\d{8}$/.test(oyw)) return oyw.slice(0, 4);
  return '';
}

function extractRowWeek(row) {
  const direct = String(row?.OrderWeek ?? row?.orderWeek ?? row?.week ?? row?._scopedOrderWeek ?? '').trim();
  if (!direct) return '';
  const m = direct.match(/^(?:\d{4}-)?(\d{2}-\d{2})$/);
  return m ? m[1] : '';
}

/**
 * 차수·연도 스코프 엄격 검증.
 * - NN-NN만 전달 시 explicit year 없으면 ORDER_YEAR_REQUIRED 오류.
 * - YYYY-NN-NN과 year가 다르면 ORDER_YEAR_MISMATCH 오류.
 */
export function resolveAbsorbScope({ week, year, orderWeek: rawOrderWeek, orderYear: rawOrderYear } = {}) {
  const effectiveWeek = week || (rawOrderWeek ? (rawOrderYear && !/^\d{4}-/.test(String(rawOrderWeek)) ? `${rawOrderYear}-${rawOrderWeek}` : rawOrderWeek) : '');
  const effectiveYear = year ?? rawOrderYear ?? '';
  const { orderYear, orderWeek } = requireOrderYear(effectiveWeek, effectiveYear);
  return {
    orderYear: String(orderYear),
    orderWeek: String(orderWeek),
    fullWeek: `${orderYear}-${orderWeek}`,
    orderYearWeek: `${orderYear}${String(orderWeek).replace('-', '')}`,
  };
}

/**
 * 교차연도 오염 방지 필터: 선택 연도(및 선택 차수)와 정확히 일치하는 행만 남긴다.
 * - 전년도 동일 차수(예: 2025-45-01) 및 연도 미표기 레거시/노이즈 행을 모두 제외한다.
 */
export function filterSameYearOrderRows(rows = [], scope = {}) {
  const targetYear = String(scope?.orderYear || '').trim();
  const targetWeek = String(scope?.orderWeek || '').trim();
  if (!/^\d{4}$/.test(targetYear) || !Array.isArray(rows)) return [];

  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const rowYear = extractRowYear(row);
    if (!rowYear || rowYear !== targetYear) return false;
    const rowWeek = extractRowWeek(row);
    if (targetWeek && rowWeek && rowWeek !== targetWeek) return false;
    return true;
  });
}

function resolveProductKey(product) {
  const pk = Number(product?.ProdKey ?? product?.prodKey);
  return Number.isInteger(pk) && pk > 0 ? pk : null;
}

function resolveCustomerKey(customer) {
  const ck = Number(customer?.CustKey ?? customer?.custKey);
  return Number.isInteger(ck) && ck > 0 ? ck : null;
}

/**
 * 선택 (OrderYear, OrderWeek, CustKey, ProdKey)에 대해 기존 활성 주문·출고 상태를 판별한다.
 * - 동일 연도·차수의 행만 인정하고, 타 연도 동일 차수 행은 무시한다.
 * - 명시 0원 단가(Cost/curCost/단가 === 0)는 product.Cost 로 덮어쓰지 않고 0 그대로 유지한다.
 */
export function detectOrderRegistrationState({
  scope,
  customer,
  product,
  orderRows = [],
  shipmentRows = [],
} = {}) {
  const resolvedScope = resolveAbsorbScope(scope);
  const custKey = resolveCustomerKey(customer);
  const prodKey = resolveProductKey(product);
  if (!custKey) throw makeAbsorbError('거래처를 선택하세요.', 'CUSTOMER_REQUIRED');
  if (!prodKey) throw makeAbsorbError('품목을 선택하세요.', 'PRODUCT_REQUIRED');

  const sameYearOrders = filterSameYearOrderRows(orderRows, resolvedScope).filter((row) => {
    const rowCust = Number(row?.CustKey ?? row?.custKey);
    const rowProd = row?.ProdKey ?? row?.prodKey;
    if (rowCust !== custKey) return false;
    if (rowProd !== undefined && rowProd !== null && Number(rowProd) !== prodKey) return false;
    return true;
  });

  const activeOrderRows = sameYearOrders.filter((row) => {
    if (row?.noOrder === true) return false;
    const oq = Number(row?.주문수량 ?? row?.orderQty ?? row?.OrderQuantity ?? row?.OutQuantity ?? 0);
    return oq > SHIPMENT_OUT_QTY_EPS;
  });

  const currentOrderQty = roundQty4(
    activeOrderRows.reduce(
      (sum, row) => sum + Number(row?.주문수량 ?? row?.orderQty ?? row?.OrderQuantity ?? row?.OutQuantity ?? 0),
      0,
    ),
  );
  const hasActiveOrder = currentOrderQty > SHIPMENT_OUT_QTY_EPS;

  const sameYearShipments = filterSameYearOrderRows(shipmentRows, resolvedScope).filter((row) => {
    const rowCust = row?.CustKey ?? row?.custKey;
    const rowProd = row?.ProdKey ?? row?.prodKey;
    if (rowCust !== undefined && rowCust !== null && Number(rowCust) !== custKey) return false;
    if (rowProd !== undefined && rowProd !== null && Number(rowProd) !== prodKey) return false;
    return true;
  });

  const matchedShipment = sameYearShipments.find(
    (row) => Number(row?.SdetailKey ?? row?.sdetailKey ?? 0) > 0
      || Number(row?.curOut ?? row?.출고수량 ?? row?.OutQuantity ?? 0) > SHIPMENT_OUT_QTY_EPS,
  ) || sameYearShipments[0] || sameYearOrders.find(
    (row) => Number(row?.SdetailKey ?? row?.sdetailKey ?? 0) > 0,
  ) || sameYearOrders[0] || null;

  const currentSdetailKey = Number(matchedShipment?.SdetailKey ?? matchedShipment?.sdetailKey ?? 0) || null;
  const currentOutQty = roundQty4(
    matchedShipment?.curOut ?? matchedShipment?.출고수량 ?? matchedShipment?.OutQuantity ?? 0,
  );
  const hasActiveShipment = Boolean(currentSdetailKey) || isActiveShipmentOutQty(currentOutQty);

  const shipmentCost = parseExplicitNumber(matchedShipment?.curCost ?? matchedShipment?.Cost ?? matchedShipment?.단가);
  const fallbackCost = parseExplicitNumber(customer?.Cost ?? customer?.단가 ?? product?.Cost);
  const expectedCost = shipmentCost !== null && !Number.isNaN(shipmentCost) && shipmentCost >= 0
    ? shipmentCost
    : (fallbackCost !== null && !Number.isNaN(fallbackCost) && fallbackCost >= 0 ? fallbackCost : 0);

  return {
    scope: resolvedScope,
    custKey,
    prodKey,
    hasActiveOrder,
    requiresPrecedingOrder: !hasActiveOrder,
    currentOrderQty,
    currentOutQty,
    hasActiveShipment,
    currentSdetailKey,
    expectedCost,
    excludedCrossYearCount: (Array.isArray(orderRows) ? orderRows.length : 0) - filterSameYearOrderRows(orderRows, resolvedScope).length,
  };
}

/**
 * 사용자 입력 수량(박스/단/송이)을 Product.OutUnit 단일 기준값 및 3단위(Box/Bunch/Steam)로 환산한다.
 * - 단위 환산정보(BunchOf1Box, SteamOf1Box) 누락 시 PRODUCT_UNIT_CONVERSION_MISSING 오류를 즉시 발생시킨다.
 * - OutQuantity 단일값 규칙과 EstQuantity(EstUnit 기준)를 함께 계산한다.
 */
export function convertAbsorbQuantity({
  inputQty,
  inputUnit,
  entryMode = ABSORB_ENTRY_MODES.FINAL,
  currentOutQty = 0,
  product = {},
} = {}) {
  const mode = String(entryMode || ABSORB_ENTRY_MODES.FINAL).trim().toUpperCase();
  if (mode !== ABSORB_ENTRY_MODES.FINAL && mode !== ABSORB_ENTRY_MODES.DELTA) {
    throw makeAbsorbError(`지원하지 않는 입력 모드입니다: ${entryMode}`, 'ABSORB_ENTRY_MODE_INVALID');
  }

  const parsedQty = parseExplicitNumber(inputQty);
  if (parsedQty === null || Number.isNaN(parsedQty) || parsedQty < 0) {
    throw makeAbsorbError('분배 수량은 0 이상의 유한한 숫자여야 합니다.', 'ABSORB_QUANTITY_INVALID');
  }
  const baseOutQty = parseExplicitNumber(currentOutQty);
  if (baseOutQty === null || Number.isNaN(baseOutQty) || baseOutQty < 0) {
    throw makeAbsorbError('기존 출고 수량 기준이 올바르지 않습니다.', 'CURRENT_OUT_QTY_INVALID');
  }

  const prodOutUnit = normalizeOrderUnit(product?.OutUnit, '박스');
  const prodEstUnit = normalizeOrderUnit(product?.EstUnit, prodOutUnit);
  const normalizedInputUnit = normalizeOrderUnit(inputUnit || prodOutUnit, prodOutUnit);

  // lib/adjustUnits.js 로 환산계수 검증 + OutUnit 기준 delta/converted 수량 계산
  const converted = computeShipmentAdjustUnits({
    curOut: 0,
    delta: parsedQty,
    type: 'ADD',
    unit: normalizedInputUnit,
    outUnit: prodOutUnit,
    bunchOf1Box: product?.BunchOf1Box,
    steamOf1Box: product?.SteamOf1Box,
    steamOf1Bunch: product?.SteamOf1Bunch,
    estUnit: prodEstUnit,
  });

  const inputOutQty = roundQty4(converted.deltaOut);
  const targetOutQty = mode === ABSORB_ENTRY_MODES.DELTA
    ? roundQty4(baseOutQty + inputOutQty)
    : inputOutQty;
  const deltaOutQty = roundQty4(targetOutQty - baseOutQty);

  const normalizedProduct = {
    OutUnit: prodOutUnit,
    EstUnit: prodEstUnit,
    BunchOf1Box: Number(product?.BunchOf1Box || 0),
    SteamOf1Box: Number(product?.SteamOf1Box || 0),
    SteamOf1Bunch: Number(product?.SteamOf1Bunch || 0),
  };
  // toOrderUnits 는 FormOrderAdd/toAllUnits 와 동일하게 단+송이 이중나눗셈 없이 3단위(Box/Bunch/Steam)를 산출한다.
  const exactUnits = toOrderUnits(targetOutQty, prodOutUnit, normalizedProduct);
  const resolvedBox = roundQty4(exactUnits.box);
  const resolvedBunch = roundQty4(exactUnits.bunch);
  const resolvedSteam = roundQty4(
    exactUnits.steam > 0
      ? exactUnits.steam
      : (prodOutUnit === '단' && normalizedProduct.SteamOf1Bunch > 0 ? targetOutQty * normalizedProduct.SteamOf1Bunch : exactUnits.steam),
  );
  const estRaw = prodEstUnit === '박스'
    ? (resolvedBox || resolvedBunch || resolvedSteam)
    : prodEstUnit === '단'
      ? (resolvedBunch || resolvedSteam || resolvedBox)
      : (resolvedSteam || resolvedBunch || resolvedBox);
  const estQuantity = Math.round(estRaw || targetOutQty);

  return {
    entryMode: mode,
    inputQty: parsedQty,
    inputUnit: normalizedInputUnit,
    outUnit: prodOutUnit,
    estUnit: prodEstUnit,
    inputOutQty,
    currentOutQty: baseOutQty,
    targetOutQty,
    deltaOutQty,
    orderUnits: {
      box: resolvedBox,
      bunch: resolvedBunch,
      steam: resolvedSteam,
      outQuantity: targetOutQty,
      estQuantity,
    },
    shipmentUnits: {
      box: resolvedBox,
      bunch: resolvedBunch,
      steam: resolvedSteam,
      outQuantity: targetOutQty,
      estQuantity,
    },
  };
}

/**
 * 실행 계획 수립:
 * - 미등록 업체(!hasActiveOrder)에 수량 0 이하 가짜 주문 생성 절대 차단(ZERO_ORDER_FORBIDDEN).
 * - 기존 주문 업체(hasActiveOrder)는 orderPayload = null(주문 API 절대 미호출).
 * - 명시적 0원 단가 보존(unitCost === 0 허용).
 */
export function buildAbsorbExecutionPlan({
  scope,
  customer,
  product,
  orderRows = [],
  shipmentRows = [],
  inputQty,
  inputUnit,
  entryMode = ABSORB_ENTRY_MODES.FINAL,
  unitCost,
  outDate = '',
  memo = '',
  confirmGatePassed = false,
} = {}) {
  const state = detectOrderRegistrationState({
    scope,
    customer,
    product,
    orderRows,
    shipmentRows,
  });

  const conversion = convertAbsorbQuantity({
    inputQty,
    inputUnit,
    entryMode,
    currentOutQty: state.currentOutQty,
    product,
  });

  if (state.requiresPrecedingOrder && !(conversion.targetOutQty > SHIPMENT_OUT_QTY_EPS)) {
    throw makeAbsorbError(
      '주문이 없는 업체에는 0 이하 수량으로 가짜 주문을 생성할 수 없습니다. 0보다 큰 수량을 입력하세요.',
      'ZERO_ORDER_FORBIDDEN',
    );
  }

  const parsedCostInput = parseExplicitNumber(unitCost);
  if (Number.isNaN(parsedCostInput) || (parsedCostInput !== null && parsedCostInput < 0)) {
    throw makeAbsorbError('단가는 0 이상의 숫자여야 합니다.', 'UNIT_COST_INVALID');
  }
  const effectiveUnitCost = parsedCostInput !== null ? parsedCostInput : state.expectedCost;
  const priceChanged = Math.abs(effectiveUnitCost - state.expectedCost) > 1e-8;
  const qtyChanged = Math.abs(conversion.targetOutQty - state.currentOutQty) > 1e-8;

  if (!state.requiresPrecedingOrder && !qtyChanged && !priceChanged) {
    throw makeAbsorbError('기존 출고분배 수량 및 단가와 동일해 변경 사항이 없습니다.', 'NO_DISTRIBUTION_CHANGE');
  }

  const { amount, vat } = amountVatFromCostEst(effectiveUnitCost, conversion.shipmentUnits.estQuantity);
  const custName = String(customer?.CustName ?? customer?.custName ?? '').trim();
  const prodName = String(product?.ProdName ?? product?.prodName ?? '').trim();
  const cleanMemo = String(memo || '').trim();
  const cleanOutDate = String(outDate || '').trim();

  // Step 1: 미등록 업체일 때만 기존 검증된 표준 주문 API (source: 'manual-order') 페이로드 구성.
  // qty 는 Product.OutUnit 단일 기준으로 넘겨 OrderDetail.OutQuantity 및 3단위가 분배값과 정확히 일치하도록 유지.
  const orderPayload = state.requiresPrecedingOrder
    ? {
        custKey: state.custKey,
        custName,
        week: state.scope.orderWeek,
        year: state.scope.orderYear,
        source: 'manual-order',
        items: [
          {
            prodKey: state.prodKey,
            prodName,
            qty: conversion.targetOutQty,
            unit: conversion.outUnit,
            ...(cleanMemo ? { descr: cleanMemo } : {}),
          },
        ],
      }
    : null;

  // Step 2: 기존 표준 출고분배 API (source: 'distribution-workspace' + expected CAS 기준값).
  const distributePayload = {
    week: state.scope.orderWeek,
    year: state.scope.orderYear,
    source: 'distribution-workspace',
    ...(cleanOutDate ? { outDate: cleanOutDate } : {}),
    entries: [
      {
        custKey: state.custKey,
        prodKey: state.prodKey,
        outQty: conversion.targetOutQty,
        cost: effectiveUnitCost,
        expected: {
          outQty: state.currentOutQty,
          cost: state.expectedCost,
        },
      },
    ],
  };

  return {
    businessIdentity: {
      OrderYear: state.scope.orderYear,
      OrderWeek: state.scope.orderWeek,
      CustKey: state.custKey,
      ProdKey: state.prodKey,
    },
    scope: state.scope,
    customer: { custKey: state.custKey, custName },
    product: {
      prodKey: state.prodKey,
      prodName,
      outUnit: conversion.outUnit,
      estUnit: conversion.estUnit,
      bunchOf1Box: Number(product?.BunchOf1Box || 0),
      steamOf1Box: Number(product?.SteamOf1Box || 0),
    },
    state,
    conversion,
    effectiveUnitCost,
    estimatePreview: {
      estQuantity: conversion.shipmentUnits.estQuantity,
      amount,
      vat,
      gross: amount + vat,
    },
    requiresPrecedingOrder: state.requiresPrecedingOrder,
    confirmGatePassed: Boolean(confirmGatePassed),
    orderPayload,
    distributePayload,
    sideEffects: state.requiresPrecedingOrder
      ? ABSORB_SIDE_EFFECT_MATRIX.UNREGISTERED_ORDER_ABSORB
      : ABSORB_SIDE_EFFECT_MATRIX.EXISTING_ORDER_DISTRIBUTE_ONLY,
  };
}

/**
 * 순차·원자성 가드 실행기:
 * 1) 미등록 업체 흡수 시 confirmGatePassed !== true 면 즉시 차단.
 * 2) refreshBeforeWrite 로 실행 직전 동시 주문 등록 여부를 재확인 (이미 등록됐다면 중복 가산 방지를 위해 중단).
 * 3) checkFixedScopes 로 품목군 확정 여부 확인 후 필요 시 runFixCycle 래핑.
 * 4) Step 1 (POST /api/orders) 실행 → 실패/미검증 시 Step 2 를 절대 호출하지 않고 즉시 중단.
 * 5) Step 2 (POST /api/shipment/distribute) 실행 → Step 1 완료 후 Step 2 실패 시 명확한 복구 상태 반환.
 */
export async function executeOrderAbsorbWorkflow(plan, deps = {}) {
  if (!plan || !plan.distributePayload) {
    throw makeAbsorbError('실행 계획이 비어 있습니다.', 'ABSORB_PLAN_REQUIRED');
  }
  const {
    requestOrder,
    requestDistribute,
    refreshBeforeWrite,
    checkFixedScopes,
    confirmFixCycle,
    runFixCycle,
    refreshAfter,
    onProgress,
  } = deps;

  if (typeof requestDistribute !== 'function') {
    throw makeAbsorbError('출고분배 API 호출기가 필요합니다.', 'DISTRIBUTE_HANDLER_REQUIRED');
  }
  if (plan.requiresPrecedingOrder) {
    if (!plan.confirmGatePassed) {
      throw makeAbsorbError(
        '미등록 업체 선행 주문 등록 확인 체크를 먼저 승인하세요.',
        'ORDER_ABSORB_CONFIRM_REQUIRED',
      );
    }
    if (typeof requestOrder !== 'function' || !plan.orderPayload) {
      throw makeAbsorbError('주문등록 API 호출기 또는 주문 페이로드가 없습니다.', 'ORDER_HANDLER_REQUIRED');
    }
  }

  onProgress?.('실행 전 원장 상태 재조회 중');
  if (typeof refreshBeforeWrite === 'function') {
    const freshSnapshot = await refreshBeforeWrite(plan.businessIdentity);
    if (freshSnapshot && Array.isArray(freshSnapshot.orderRows)) {
      const latest = detectOrderRegistrationState({
        scope: plan.scope,
        customer: { CustKey: plan.customer.custKey, CustName: plan.customer.custName },
        product: {
          ProdKey: plan.product.prodKey,
          ProdName: plan.product.prodName,
          OutUnit: plan.product.outUnit,
        },
        orderRows: freshSnapshot.orderRows,
        shipmentRows: freshSnapshot.shipmentRows || [],
      });
      if (plan.requiresPrecedingOrder && latest.hasActiveOrder) {
        throw makeAbsorbError(
          `실행 직전 확인에서 ${plan.scope.fullWeek} ${plan.customer.custName || plan.customer.custKey}의 주문(${latest.currentOrderQty} ${plan.product.outUnit})이 이미 등록되어 있습니다. 최신 상태로 재조회한 뒤 분배만 저장하세요.`,
          'ORDER_ALREADY_REGISTERED_CONFLICT',
          { latestState: latest },
        );
      }
      if (!plan.requiresPrecedingOrder && (
        Math.abs(latest.currentOutQty - plan.state.currentOutQty) > 1e-8
        || Math.abs(latest.expectedCost - plan.state.expectedCost) > 1e-8
      )) {
        throw makeAbsorbError(
          '실행 직전 확인에서 다른 사용자의 분배 수량 또는 단가 변경이 감지되었습니다. 재조회 후 다시 저장하세요.',
          'DISTRIBUTION_STALE_PRECHECK',
          { latestState: latest },
        );
      }
    }
  }

  let fixCycleUsed = false;
  let fixScopeInfo = null;
  if (typeof checkFixedScopes === 'function') {
    onProgress?.('품목군 확정 상태 확인 중');
    const fixedResp = await checkFixedScopes(plan.scope, [plan.product.prodKey]);
    if (fixedResp?.success !== true) {
      throw makeAbsorbError(fixedResp?.error || '품목군 확정 상태 확인에 실패해 중단했습니다.', 'FIX_SCOPE_CHECK_FAILED');
    }
    fixScopeInfo = distributionFixCycleScope(fixedResp.scopes || []);
    if (fixScopeInfo.blocked.length > 0) {
      throw makeAbsorbError(
        `품목군이 비어 있는 확정 품목(ProdKey ${fixScopeInfo.blocked.join(', ')})이 있어 자동 확정해제를 진행할 수 없습니다.`,
        'FIXED_SCOPE_BLOCKED',
        { blocked: fixScopeInfo.blocked },
      );
    }
    if (fixScopeInfo.needed) {
      if (typeof confirmFixCycle === 'function') {
        const accepted = await confirmFixCycle(fixScopeInfo, plan);
        if (!accepted) {
          throw makeAbsorbError('사용자가 확정차수 해제·재확정 저장을 취소했습니다.', 'FIX_CYCLE_CANCELLED', { cancelled: true });
        }
      }
      if (typeof runFixCycle !== 'function') {
        throw makeAbsorbError('확정된 품목군을 처리할 확정 사이클 실행기가 필요합니다.', 'FIX_CYCLE_RUNNER_REQUIRED');
      }
      fixCycleUsed = true;
    }
  }

  let step1Result = null;
  let step1Committed = false;
  let step2Result = null;

  const applySequential = async () => {
    if (plan.requiresPrecedingOrder && plan.orderPayload) {
      onProgress?.('1단계: 미등록 업체 선행 주문등록(OrderMaster/Detail + 빈 출고헤더) 중');
      let orderResp;
      try {
        orderResp = await requestOrder(plan.orderPayload);
      } catch (err) {
        throw makeAbsorbError(
          `1단계 선행 주문등록 실패 — 후속 출고분배를 즉시 중단했습니다. (${err.message || err})`,
          'STEP1_ORDER_FAILED',
          {
            step1Committed: false,
            step2Executed: false,
            cause: err,
          },
        );
      }
      const orderItems = Array.isArray(orderResp?.results) ? orderResp.results : [];
      const badItem = orderItems.find((item) => item?.status === 'NOT_FOUND' || item?.status === 'SKIPPED');
      if (orderResp?.success !== true || orderResp?.verified !== true || badItem) {
        throw makeAbsorbError(
          `1단계 선행 주문등록 검증 실패 — 후속 출고분배를 실행하지 않았습니다. (${orderResp?.error || badItem?.status || 'unverified'})`,
          'STEP1_ORDER_UNVERIFIED',
          {
            step1Committed: false,
            step2Executed: false,
            orderResp,
          },
        );
      }
      step1Result = orderResp;
      step1Committed = true;
    }

    onProgress?.('2단계: 출고분배(ShipmentDetail/ShipmentDate) 저장 및 사후검증 중');
    let distResp;
    try {
      distResp = await requestDistribute(plan.distributePayload);
    } catch (err) {
      if (step1Committed) {
        throw makeAbsorbError(
          `1단계 선행 주문등록은 완료되었으나 2단계 출고분배 저장 중 오류가 발생했습니다. 최신 상태를 다시 조회한 뒤 분배만 재시도하세요. (${err.message || err})`,
          'STEP2_DISTRIBUTE_FAILED_AFTER_ORDER',
          {
            step1Committed: true,
            step2Executed: true,
            step1Result,
            cause: err,
          },
        );
      }
      throw makeAbsorbError(
        `출고분배 저장 실패: ${err.message || err}`,
        err.code || 'STEP2_DISTRIBUTE_FAILED',
        {
          step1Committed: false,
          step2Executed: true,
          cause: err,
        },
      );
    }

    if (distResp?.success !== true || distResp?.verified !== true) {
      const reason = distResp?.error || '사후검증 미완료';
      if (step1Committed) {
        throw makeAbsorbError(
          `1단계 선행 주문등록은 완료되었으나 2단계 출고분배 검증에 실패했습니다. 재조회 후 분배만 다시 시도하세요. (${reason})`,
          'STEP2_DISTRIBUTE_FAILED_AFTER_ORDER',
          {
            step1Committed: true,
            step2Executed: true,
            step1Result,
            distResp,
          },
        );
      }
      throw makeAbsorbError(
        `출고분배 검증 실패: ${reason}`,
        'STEP2_DISTRIBUTE_UNVERIFIED',
        {
          step1Committed: false,
          step2Executed: true,
          distResp,
        },
      );
    }
    step2Result = distResp;
    return { step1Result, step2Result };
  };

  if (fixCycleUsed) {
    await runFixCycle({
      weeks: [plan.scope.orderWeek],
      orderYear: plan.scope.orderYear,
      countryFlowers: fixScopeInfo.countryFlowers,
      stockProdKeys: [plan.product.prodKey],
      cycleSource: 'distribute-save',
      progress: (msg) => onProgress?.(msg),
      apply: applySequential,
    });
  } else {
    await applySequential();
  }

  let refreshError = null;
  let refreshedState = null;
  if (typeof refreshAfter === 'function') {
    onProgress?.('저장 후 최신 원장 상태 재조회 중');
    try {
      refreshedState = await refreshAfter(plan.businessIdentity);
    } catch (err) {
      refreshError = err?.message || String(err);
    }
  }

  return {
    success: true,
    verified: true,
    orderCreated: step1Committed,
    orderPreserved: !plan.requiresPrecedingOrder,
    fixCycleUsed,
    businessIdentity: plan.businessIdentity,
    orderResult: step1Result,
    distributeResult: step2Result,
    refreshedState,
    refreshError,
    summaryText: formatAbsorbSummary({
      plan,
      orderCreated: step1Committed,
      fixCycleUsed,
    }),
  };
}

export function formatAbsorbSummary({ plan, orderCreated = false, fixCycleUsed = false } = {}) {
  if (!plan) return '';
  const stepLabel = orderCreated ? '미등록 주문 자동흡수 + 출고분배' : '기존 주문 보존 + 출고분배';
  const fixLabel = fixCycleUsed ? ' (확정해제→저장→재확정)' : '';
  return `${plan.scope.fullWeek} · ${plan.customer.custName || plan.customer.custKey} · ${plan.product.prodName || plan.product.prodKey} · ${plan.conversion.targetOutQty}${plan.product.outUnit} [${stepLabel}${fixLabel}]`;
}
