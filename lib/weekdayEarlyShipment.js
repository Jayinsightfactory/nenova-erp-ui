import crypto from 'crypto';
import { dateKey } from './weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
const round3 = value => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function earlyShipmentError(code, message, statusCode = 409, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...extra });
}

function requiredInteger(value, name, min = 1) {
  const number = Number(value);
  if (value == null || value === '' || !Number.isSafeInteger(number) || number < min)
    throw earlyShipmentError('EARLY_INVALID_REQUEST', `${name} 값이 올바르지 않습니다.`, 400);
  return number;
}

export function exactEarlyQuantity(value, name = 'quantity') {
  const number = Number(value);
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(number)
    || number <= 0 || number > 999999999 || Math.abs(round2(number) - number) > 1e-9)
    throw earlyShipmentError('EARLY_QUANTITY_PRECISION', `${name}은 양수이며 재고 원장 소수 둘째 자리까지 정확해야 합니다.`, 400);
  return round2(number);
}

export function normalizeEarlyShipmentRequest(body = {}) {
  const operationId = String(body.operationId ?? '').trim();
  const action = String(body.action ?? '').toUpperCase();
  if (!UUID.test(operationId) || !['PREVIEW', 'APPLY', 'REVERSE'].includes(action))
    throw earlyShipmentError('EARLY_INVALID_REQUEST', 'action과 operationId UUID를 확인하세요.', 400);
  const sourceYear = requiredInteger(body.sourceYear, 'sourceYear', 2026);
  const targetYear = requiredInteger(body.targetYear, 'targetYear', 2026);
  const sourceMajorWeek = String(body.sourceMajorWeek ?? '').padStart(2, '0');
  const targetMajorWeek = String(body.targetMajorWeek ?? '').padStart(2, '0');
  if (!/^\d{2}$/.test(sourceMajorWeek) || !/^\d{2}$/.test(targetMajorWeek)
    || Number(sourceMajorWeek) < 1 || Number(sourceMajorWeek) > 53
    || Number(targetMajorWeek) < 1 || Number(targetMajorWeek) > 53)
    throw earlyShipmentError('EARLY_INVALID_CYCLE', '실제 대차수를 선택하세요.', 400);
  const custKey = requiredInteger(body.custKey, 'custKey');
  const prodKey = requiredInteger(body.prodKey, 'prodKey');
  const unit = normalizeWeekdayUnit(body.unit);
  if (!unit) throw earlyShipmentError('EARLY_INVALID_UNIT', '실제 ERP OutUnit을 선택하세요.', 400);
  const quantity = exactEarlyQuantity(body.quantity);
  if (typeof body.sourceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.sourceDate))
    throw earlyShipmentError('EARLY_SOURCE_DATE', '실제 출고일 YYYY-MM-DD를 입력하세요.', 400);
  const sourceDate = dateKey(body.sourceDate);
  const allocationIntent = String(body.allocationIntent ?? '');
  if (!['MARK_EXISTING', 'APPLY_ABSOLUTE'].includes(allocationIntent))
    throw earlyShipmentError('EARLY_INVALID_INTENT', '기존 분배 분류 또는 최종 절대수량 적용 의도를 선택하세요.', 400);
  const reason = String(body.reason ?? '').trim();
  if (!reason || reason.length > 1000) throw earlyShipmentError('EARLY_INVALID_REASON', '사유를 1~1000자로 입력하세요.', 400);
  const expectedRevision = requiredInteger(body.expectedRevision, 'expectedRevision', 0);
  const allowAdditionalClassification = body.allowAdditionalClassification === true;
  if (body.allocationBody == null || typeof body.allocationBody !== 'object' || Array.isArray(body.allocationBody)
    || body.allocationBody.mode !== 'ALLOCATION' || body.allocationBody.operationId !== operationId
    || Number(body.allocationBody.custKey) !== custKey || !Array.isArray(body.allocationBody.changes)
    || body.allocationBody.changes.length !== 1)
    throw earlyShipmentError('EARLY_ALLOCATION_REQUIRED', '같은 작업번호의 단일 ALLOCATION 전산 snapshot이 필요합니다.', 400);
  const change = body.allocationBody.changes[0];
  if (Number(change.year) !== sourceYear || Number(change.prodKey) !== prodKey
    || !String(change.orderWeek ?? '').startsWith(`${sourceMajorWeek}-`)
    || normalizeWeekdayUnit(change.unit) !== unit || !Array.isArray(change.dates)
    || change.dates.length !== 1 || change.dates[0].date !== sourceDate)
    throw earlyShipmentError('EARLY_ALLOCATION_SCOPE', '원천 날짜·차수·품목과 분배 저장 범위가 다릅니다.', 400);
  const sourceDateFinal = Number(change.dates[0].quantity);
  if (!Number.isFinite(sourceDateFinal) || sourceDateFinal < quantity
    || Math.abs(round3(sourceDateFinal)-sourceDateFinal)>1e-9)
    throw earlyShipmentError('EARLY_CLASSIFICATION_CAP', '선출고 분류량은 최종 날짜 분배량을 넘을 수 없습니다.', 409);
  if (body.sourceDateFinal != null && Number(body.sourceDateFinal) !== sourceDateFinal)
    throw earlyShipmentError('EARLY_FINAL_QUANTITY_MISMATCH', '표시 최종수량과 분배 저장 절대수량이 다릅니다.', 409);
  if (body.allocationBody.reason !== reason)
    throw earlyShipmentError('EARLY_ALLOCATION_REASON', '분배 작업과 선출고 사유가 다릅니다.', 400);
  return { operationId, action, sourceYear, sourceMajorWeek, targetYear, targetMajorWeek,
    custKey, prodKey, unit, quantity, sourceDate, allocationIntent, reason, expectedRevision,
    sourceDateFinal, allowAdditionalClassification, allocationBody: body.allocationBody };
}

export function earlyShipmentRequestHash(request) {
  const values = { ...request, action: request.action === 'PREVIEW' ? 'APPLY' : request.action };
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function assertEarlyClassification({ quantity, alreadyClassified, finalQuantity, beforeQuantity, intent,
  allowAdditionalClassification = false }) {
  if (alreadyClassified > 0 && !allowAdditionalClassification)
    throw earlyShipmentError('EARLY_ADDITIONAL_INTENT_REQUIRED', '같은 날짜에 기존 선출고 분류가 있습니다. 추가 등록 의도를 명시하세요.', 409);
  if (!Number.isFinite(alreadyClassified) || alreadyClassified < 0
    || round3(alreadyClassified + quantity) > finalQuantity)
    throw earlyShipmentError('EARLY_CLASSIFICATION_CAP', '이 날짜의 활성 선출고 분류량이 최종 분배량을 넘습니다.', 409);
  if (intent === 'MARK_EXISTING' && Math.abs(finalQuantity - beforeQuantity) > 1e-9)
    throw earlyShipmentError('EARLY_MARK_EXISTING_CHANGED', '기존 분배 분류는 날짜 분배량을 변경할 수 없습니다.', 409);
  return { sourceDateBefore: beforeQuantity, sourceDateFinal: finalQuantity,
    sourceDateDelta: round3(finalQuantity - beforeQuantity), classifiedQuantity: quantity };
}

export function earlyStockDelta(quantity, direction) {
  if (!['SOURCE', 'TARGET', 'REVERSE_SOURCE', 'REVERSE_TARGET'].includes(direction))
    throw new TypeError('Invalid stock effect direction');
  const sign = direction === 'SOURCE' || direction === 'REVERSE_TARGET' ? 1 : -1;
  return sign * exactEarlyQuantity(quantity);
}
