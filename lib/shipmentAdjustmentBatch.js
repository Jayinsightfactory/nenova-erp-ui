import { requireOrderYear } from './orderUtils.js';

const MAX_BATCH_SIZE = 1000;

export function isShipmentAdjustmentBatchPreflight(value) {
  // 명시적 boolean true만 사전검증이다. 문자열/누락/false를 truthy fallback으로
  // 오판하면 실제 저장 요청이 조용히 rollback될 수 있으므로 계약으로 고정한다.
  return value === true;
}

function batchInputError(message, code = 'SHIPMENT_ADJUST_BATCH_INPUT_INVALID') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

export function normalizeShipmentAdjustmentBatch(body = {}) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0 || entries.length > MAX_BATCH_SIZE) {
    throw batchInputError(`entries는 1~${MAX_BATCH_SIZE}건이어야 합니다.`);
  }

  let batchScope;
  try {
    batchScope = requireOrderYear(body.week, body.year || body.orderYear || '');
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }

  const normalized = entries.map((raw, inputIndex) => {
    const type = String(raw?.type || '').trim().toUpperCase();
    if (type !== 'ADD' && type !== 'CANCEL') {
      throw batchInputError(`${inputIndex + 1}번째 항목 type은 ADD 또는 CANCEL이어야 합니다.`);
    }
    const custKey = Number(raw?.custKey);
    const prodKey = Number(raw?.prodKey);
    const qty = Number(raw?.qty);
    if (!Number.isInteger(custKey) || custKey <= 0 || !Number.isInteger(prodKey) || prodKey <= 0) {
      throw batchInputError(`${inputIndex + 1}번째 항목의 CustKey/ProdKey가 올바르지 않습니다.`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw batchInputError(`${inputIndex + 1}번째 항목 qty는 양수여야 합니다.`);
    }

    let entryScope;
    try {
      entryScope = requireOrderYear(
        raw?.week || batchScope.orderWeek,
        raw?.year || raw?.orderYear || batchScope.orderYear,
      );
    } catch (error) {
      error.statusCode = 400;
      throw error;
    }
    if (entryScope.orderYear !== batchScope.orderYear || entryScope.orderWeek !== batchScope.orderWeek) {
      throw batchInputError(
        `${inputIndex + 1}번째 항목의 연도/차수가 일괄 범위 ${batchScope.orderYear}-${batchScope.orderWeek}와 다릅니다.`,
        'SHIPMENT_ADJUST_BATCH_SCOPE_MISMATCH',
      );
    }

    return {
      inputIndex,
      body: {
        ...raw,
        custKey,
        prodKey,
        qty,
        year: batchScope.orderYear,
        week: batchScope.orderWeek,
        type,
        // 전체 붙여넣기는 입고/재고 부족을 자동 우회하지 않는다.
        force: false,
        // 취소는 실제 활성 분배 유무를 서버 트랜잭션 안에서 판단한다.
        mode: type === 'CANCEL' ? 'AUTO_CANCEL' : undefined,
      },
    };
  });

  const cancels = normalized.filter((entry) => entry.body.type === 'CANCEL');
  const adds = normalized.filter((entry) => entry.body.type === 'ADD');
  return {
    orderYear: batchScope.orderYear,
    orderWeek: batchScope.orderWeek,
    entries: [...cancels, ...adds],
  };
}

export async function runShipmentAdjustmentBatchTransaction({
  batch,
  user,
  capabilities,
  withTransactionFn,
  executeEntryFn,
}) {
  if (typeof withTransactionFn !== 'function' || typeof executeEntryFn !== 'function') {
    throw new TypeError('일괄 트랜잭션 실행 함수와 단건 조정 코어가 필요합니다.');
  }

  let activeEntry = null;
  try {
    const results = await withTransactionFn(async (tQ) => {
      // deadlock 재시도마다 결과 배열을 새로 만들어 commit된 마지막 attempt만 반환한다.
      const attemptResults = [];
      for (let executionIndex = 0; executionIndex < batch.entries.length; executionIndex += 1) {
        const entry = batch.entries[executionIndex];
        activeEntry = { executionIndex, inputIndex: entry.inputIndex, ...entry.body };
        const result = await executeEntryFn(tQ, {
          body: entry.body,
          user,
          capabilities,
        });
        attemptResults.push({
          ...result,
          entryId: entry.body?.entryId || null,
          executionIndex,
          inputIndex: entry.inputIndex,
        });
      }
      // 각 행의 원장·전산뷰·출고일 재조회까지 모두 통과해야만 일괄 commit한다.
      // 하나라도 검증표시가 없으면 이전 버전/누락 구현으로 간주해 전체 롤백한다.
      if (attemptResults.some((result) => result?.verified !== true)) {
        const error = new Error('저장 직후 전산 대조가 완료되지 않은 항목이 있어 전체 변경을 되돌렸습니다.');
        error.statusCode = 409;
        error.code = 'SHIPMENT_BATCH_POST_WRITE_UNVERIFIED';
        throw error;
      }
      return attemptResults;
    });
    return results;
  } catch (error) {
    error.failedEntry = activeEntry;
    throw error;
  }
}
