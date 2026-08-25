import { isDefectAdmin, isEarlierOrSameScope } from './salesDefectDeductionCore.js';

const EPSILON = 0.0001;
const text = (value) => String(value ?? '').trim();
const identity = (value) => text(value).toLowerCase().replace(/\s+/g, '');

/**
 * 업체/품목 전산 매칭만 바꾸는 저장은 수입부 확정 감사상태를 유지한다.
 * 수량·단위·크레딧·농장·비고 변경은 수입부 확인 대상 값이므로 재확인이 필요하다.
 */
export function shouldResetIncomingConfirmation(before = {}, next = {}) {
  return Number(before.quantity ?? before.Quantity ?? 0) !== Number(next.quantity ?? next.Quantity ?? 0)
    || text(before.sourceUnit ?? before.SourceUnit) !== text(next.sourceUnit ?? next.SourceUnit)
    || Boolean(before.creditApplied ?? before.CreditApplied) !== Boolean(next.creditApplied ?? next.CreditApplied)
    || text(before.farmName ?? before.FarmName) !== text(next.farmName ?? next.FarmName)
    || text(before.note ?? before.Note) !== text(next.note ?? next.Note);
}

export function resolveDeductionOwner(row = {}) {
  const createdBy = text(row.CreatedBy ?? row.createdBy);
  const createdByName = text(row.CreatedByName ?? row.createdByName);
  if (createdBy || createdByName) return { id: createdBy, name: createdByName, source: 'CREATED' };
  return {
    id: text(row.UpdatedBy ?? row.updatedBy),
    name: text(row.UpdatedByName ?? row.updatedByName),
    source: 'LEGACY_UPDATED',
  };
}

export function isDeductionOwnedByUser(row = {}, user = {}) {
  if (isDefectAdmin(user)) return true;
  const owner = resolveDeductionOwner(row);
  const userIds = new Set([
    identity(user.userId ?? user.UserID), identity(user.userName ?? user.UserName),
  ].filter(Boolean));
  if (!userIds.size || (!owner.id && !owner.name)) return false;
  return [owner.id, owner.name].some((value) => userIds.has(identity(value)));
}

export function assertDeductionMutationOwnership(row = {}, user = {}) {
  if (!isDeductionOwnedByUser(row, user)) {
    throw new Error('다른 담당자가 작성한 불량차감 원장은 수정하거나 삭제할 수 없습니다.');
  }
  return true;
}

export function assertIncomingConfirmed(row = {}) {
  if (!Boolean(row.ImportConfirmed ?? row.importConfirmed)) {
    throw new Error('수입부 확정이 완료된 행만 견적서에 등록할 수 있습니다.');
  }
  return true;
}

export function assertDeductionRegistrationScope(row = {}, targetYear, targetWeek) {
  const sourceYear = Number(row.OrderYear ?? row.orderYear);
  const sourceWeek = String(row.OrderWeek ?? row.orderWeek ?? '');
  const appliedYear = Number(row.AppliedOrderYear ?? row.appliedOrderYear ?? 0);
  const appliedWeek = String(row.AppliedOrderWeek ?? row.appliedOrderWeek ?? '');
  const estimateKey = Number(row.EstimateKey ?? row.estimateKey ?? 0);
  const carryover = Boolean(row.IsCarryoverLedger ?? row.isCarryoverLedger);
  if (!isEarlierOrSameScope(sourceYear, sourceWeek, targetYear, targetWeek)) {
    throw new Error(`원차수 ${sourceYear}년 ${sourceWeek}차는 적용 대상 ${targetYear}년 ${targetWeek}차보다 뒤입니다.`);
  }
  if (!carryover && estimateKey && appliedYear && appliedWeek
      && (appliedYear !== Number(targetYear) || appliedWeek !== String(targetWeek))) {
    throw new Error(`이미 ${appliedYear}년 ${appliedWeek}차 견적서에 등록된 행입니다.`);
  }
  if (!carryover && estimateKey && (!appliedYear || !appliedWeek)
      && (sourceYear !== Number(targetYear) || sourceWeek !== String(targetWeek))) {
    throw new Error(`기존 견적서의 적용 차수 정보가 없어 ${sourceYear}년 ${sourceWeek}차에서만 수정할 수 있습니다.`);
  }
  return true;
}

export function planManualProcessingComplete({ row = {}, targetYear, targetWeek } = {}) {
  if (Number(row.IsDeleted ?? row.isDeleted) === 1) throw new Error('삭제된 차감 행입니다.');
  const y = Number(targetYear);
  const w = String(targetWeek ?? '').trim();
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const status = String(row.Status ?? row.status ?? '').toUpperCase();
  const estimateKey = Number(row.EstimateKey ?? row.estimateKey ?? 0);
  if (estimateKey > 0 || status === 'REGISTERED') {
    throw new Error('이미 견적서관리에 등록된 행입니다. 수동처리완료로 표시할 수 없습니다.');
  }
  if (status === 'MANUAL_COMPLETED') {
    return { action: 'NOOP', writeCount: 0, status: 'MANUAL_COMPLETED' };
  }
  if (status === 'COMPLETED') {
    return { action: 'NOOP', writeCount: 0, status: 'COMPLETED' };
  }
  assertDeductionRegistrationScope(row, targetYear, targetWeek);
  return {
    action: 'MANUAL_COMPLETE',
    writeCount: 1,
    status: 'MANUAL_COMPLETED',
    remainingQuantity: 0,
    appliedOrderYear: y,
    appliedOrderWeek: w,
  };
}

export function planDeductionRegistration({
  row = {}, targetYear, targetWeek, applyQuantity, requestKey = '', existingRequestKeys = [],
  customerExists = true, productSalesRowExists = false, customerShipmentExists = null, shipmentKey = null, cost = 0,
} = {}) {
  if (Number(row.IsDeleted ?? row.isDeleted) === 1) throw new Error('삭제된 차감 행입니다.');
  if (String(row.Status ?? row.status ?? '').toUpperCase() === 'MANUAL_COMPLETED') {
    return { action: 'COMPLETE_NOOP', writeCount: 0, remainingQuantity: 0, status: 'MANUAL_COMPLETED' };
  }
  assertIncomingConfirmed(row);
  assertDeductionRegistrationScope(row, targetYear, targetWeek);
  if (!Number(row.CustKey ?? row.custKey) || !customerExists) throw new Error('거래처 매칭이 필요합니다.');
  if (!Number(row.ProdKey ?? row.prodKey)) throw new Error('품목 매칭이 필요합니다.');
  const carryover = Boolean(row.IsCarryoverLedger ?? row.isCarryoverLedger);
  const normalizedRequestKey = text(requestKey);
  const knownRequests = new Set((existingRequestKeys || []).map(text).filter(Boolean));
  if (carryover && normalizedRequestKey && knownRequests.has(normalizedRequestKey)) {
    return { action: 'IDEMPOTENT', writeCount: 0, requestKey: normalizedRequestKey };
  }
  const originalQuantity = Number(row.OriginalQuantity ?? row.originalQuantity ?? row.Quantity ?? row.quantity) || 0;
  const remainingQuantity = carryover
    ? Math.max(0, Number(row.RemainingQuantity ?? row.remainingQuantity ?? originalQuantity) || 0)
    : originalQuantity;
  if (!(originalQuantity > EPSILON)) throw new Error('차감수량이 필요합니다.');
  if (carryover && !(remainingQuantity > EPSILON)) {
    return { action: 'COMPLETE_NOOP', writeCount: 0, remainingQuantity: 0, status: 'COMPLETED' };
  }
  if (carryover && !normalizedRequestKey) throw new Error('이월 처리 요청키가 필요합니다.');
  const hasCustomerShipment = customerShipmentExists == null
    ? productSalesRowExists && Number(shipmentKey) > 0
    : customerShipmentExists && Number(shipmentKey) > 0;
  if (!hasCustomerShipment) {
    throw new Error('대상 차수에 해당 업체의 EXE 확정 출고가 없습니다.');
  }
  if (!(Number(cost) > 0)) throw new Error('이전 차수 분배 단가가 없습니다.');
  const requestedQuantity = Number(applyQuantity ?? remainingQuantity);
  if (!(requestedQuantity > EPSILON)) throw new Error('처리수량은 0보다 커야 합니다.');
  if (carryover && requestedQuantity > remainingQuantity + EPSILON) {
    throw new Error(`처리수량이 잔여수량 ${remainingQuantity}보다 큽니다.`);
  }
  const nextRemaining = carryover ? Math.max(0, remainingQuantity - requestedQuantity) : 0;
  return {
    action: 'APPLY', writeCount: 1, requestKey: normalizedRequestKey || null,
    applyQuantity: requestedQuantity, previousRemainingQuantity: remainingQuantity,
    remainingQuantity: nextRemaining,
    status: carryover && nextRemaining > EPSILON ? 'CARRYOVER' : (carryover ? 'COMPLETED' : 'REGISTERED'),
    targetYear: Number(targetYear), targetWeek: String(targetWeek),
    shipmentKey: Number(shipmentKey), cost: Number(cost),
  };
}

export function applyDeductionRegistrationPlan(row = {}, plan = {}) {
  if (plan.action !== 'APPLY') return { row: { ...row }, application: null, writeCount: 0 };
  const carryover = Boolean(row.IsCarryoverLedger ?? row.isCarryoverLedger);
  const next = {
    ...row, AppliedOrderYear: plan.targetYear, AppliedOrderWeek: plan.targetWeek,
    AppliedShipmentKey: plan.shipmentKey, EstimateCost: plan.cost, Status: plan.status,
  };
  if (carryover) next.RemainingQuantity = plan.remainingQuantity;
  return {
    row: next,
    application: carryover ? {
      RequestKey: plan.requestKey, AppliedOrderYear: plan.targetYear,
      AppliedOrderWeek: plan.targetWeek, AppliedShipmentKey: plan.shipmentKey,
      AppliedQuantity: plan.applyQuantity, AppliedCost: plan.cost,
    } : null,
    writeCount: 1,
  };
}

export function collectDeductionEstimateKeys(row = {}, applications = []) {
  return [...new Set([
    Number(row.EstimateKey ?? row.estimateKey ?? 0),
    ...(applications || []).map((item) => Number(item.EstimateKey ?? item.estimateKey ?? 0)),
  ].filter((key) => key > 0))];
}

export function emptyRegistrationAttemptResult() {
  return { registered: [], skipped: [] };
}

export function ensureRegistrationRequestKey(current, createRequestKey) {
  const existing = text(current);
  if (existing) return existing;
  if (typeof createRequestKey !== 'function') throw new TypeError('등록 요청키 생성 함수가 필요합니다.');
  const created = text(createRequestKey());
  if (!created) throw new Error('등록 요청키를 생성하지 못했습니다.');
  return created;
}

export async function runIsolatedRegistrationTransaction(withTransactionFn, runAttempt) {
  if (typeof withTransactionFn !== 'function' || typeof runAttempt !== 'function') {
    throw new TypeError('트랜잭션 실행 함수와 등록 callback이 필요합니다.');
  }
  const result = await withTransactionFn(async (tQuery, meta = {}) => {
    const attemptResult = emptyRegistrationAttemptResult();
    await runAttempt(tQuery, attemptResult, meta);
    return attemptResult;
  });
  return result || emptyRegistrationAttemptResult();
}
