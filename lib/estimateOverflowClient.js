export const ESTIMATE_OVERFLOW_PENDING_PREFIX = 'nenova.estimate.overflow-pending.v1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function stableOverflowJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Mirrors the server's idempotency fingerprint. Edit-lease tokens can rotate
// after a reload, but that must not turn the same business request into a new
// overflow operation. The persisted applyBody itself remains byte-for-byte
// unchanged when the operation is reused.
export function estimateOverflowBusinessFingerprint(body = {}) {
  return stableOverflowJson({
    orderYear: String(body.orderYear ?? body.year ?? ''),
    custKey: Number(body.custKey),
    items: body.items,
  });
}

export function estimateOverflowPendingKey({ orderYear, parentWeek, custKey } = {}) {
  const year = String(orderYear ?? '').trim();
  const parent = String(parentWeek ?? '').trim().match(/^\d{1,2}/)?.[0] || '';
  const customer = Number(custKey);
  if (!/^\d{4}$/.test(year) || !parent || !Number.isInteger(customer) || customer <= 0) return '';
  return `${ESTIMATE_OVERFLOW_PENDING_PREFIX}.${year}.${parent.padStart(2, '0')}.${customer}`;
}

export function readPendingEstimateOverflow(storage, scope) {
  const key = estimateOverflowPendingKey(scope);
  if (!key || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (!value || value.version !== 1 || value.scopeKey !== key) return null;
    if (!value.operationId || !value.baseFingerprint || !value.applyBody) return null;
    return value;
  } catch {
    return null;
  }
}

export function inspectPendingEstimateOverflow(storage, scope, baseBody) {
  const pending = readPendingEstimateOverflow(storage, scope);
  if (!pending) return { status: 'none', pending: null };
  return {
    status: pending.baseFingerprint === estimateOverflowBusinessFingerprint(baseBody) ? 'match' : 'conflict',
    pending,
  };
}

export function preparePendingEstimateOverflow({
  storage,
  scope,
  baseBody,
  preview,
  createOperationId = () => globalThis.crypto?.randomUUID?.(),
} = {}) {
  const key = estimateOverflowPendingKey(scope);
  if (!key || !storage) throw Object.assign(new Error('브라우저 작업 보관소를 사용할 수 없습니다.'), { code: 'OVERFLOW_STORAGE_UNAVAILABLE' });
  const inspected = inspectPendingEstimateOverflow(storage, scope, baseBody);
  if (inspected.status === 'conflict') {
    throw Object.assign(new Error('확인이 끝나지 않은 이전 수량 저장이 있습니다. 기존 결과를 먼저 확인한 뒤 다시 시도하세요.'), {
      code: 'OVERFLOW_PENDING_CONFLICT',
      pending: inspected.pending,
    });
  }
  if (inspected.status === 'match') return { ...inspected.pending, reused: true };

  const operationId = String(createOperationId?.() || '').trim();
  if (!operationId) throw Object.assign(new Error('수량 저장 작업 식별자를 만들 수 없습니다.'), { code: 'OVERFLOW_OPERATION_ID_UNAVAILABLE' });
  const applyBody = {
    ...baseBody,
    overflowMode: 'apply',
    overflowPlanHash: String(preview?.planHash || ''),
    overflowConfirmed: true,
    overflowOperationId: operationId,
  };
  const pending = {
    version: 1,
    scopeKey: key,
    operationId,
    baseFingerprint: estimateOverflowBusinessFingerprint(baseBody),
    baseBody,
    applyBody,
    preview,
    createdAt: Date.now(),
  };
  try {
    storage.setItem(key, JSON.stringify(pending));
  } catch (cause) {
    throw Object.assign(new Error('수량 저장 작업을 브라우저에 보관하지 못했습니다. 저장을 시작하지 않았습니다.'), {
      code: 'OVERFLOW_STORAGE_WRITE_FAILED',
      cause,
    });
  }
  return { ...pending, reused: false };
}

export function clearPendingEstimateOverflow(storage, scope, operationId) {
  const key = estimateOverflowPendingKey(scope);
  if (!key || !storage) return false;
  const pending = readPendingEstimateOverflow(storage, scope);
  if (operationId && pending?.operationId !== operationId) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function isAmbiguousEstimateOverflowFailure(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  return status >= 500
    || (status === 0 && (error?.name === 'AbortError' || error?.name === 'TypeError'))
    || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(error?.code || ''));
}

export function classifyOverflowStatusResponse(statusResponse) {
  if (!statusResponse?.success || statusResponse.found !== true) return { status: 'unknown' };
  const result = statusResponse.result;
  if (result?.success) return { status: 'success', data: result, recovered: true };
  return {
    status: result?.rolledBack === true ? 'rolledBack' : 'failed',
    data: result,
    error: Object.assign(new Error(result?.error || '서버가 저장 실패 결과를 반환했습니다.'), {
      code: result?.code,
      data: result,
    }),
  };
}

// A confirmed overflow apply is posted at most once per invocation. Ambiguous
// network/5xx outcomes are resolved only through the read-only status endpoint.
export async function runEstimateOverflowApplyOnce({ operation, postApply, readStatus } = {}) {
  try {
    const data = await postApply(operation.applyBody);
    return data?.success
      ? { status: 'success', data, recovered: false }
      : {
        status: data?.rolledBack === true ? 'rolledBack' : 'failed',
        data,
        error: Object.assign(new Error(data?.error || '수량 저장에 실패했습니다.'), { code: data?.code, data }),
      };
  } catch (error) {
    if (error?.data?.success === false && error.data.rolledBack === true) {
      return { status: 'rolledBack', error, data: error.data };
    }
    if (!isAmbiguousEstimateOverflowFailure(error)) {
      return { status: error?.data?.rolledBack === true ? 'rolledBack' : 'failed', error, data: error?.data };
    }
    try {
      const outcome = classifyOverflowStatusResponse(await readStatus(operation));
      if (outcome.status !== 'unknown') return outcome;
    } catch {
      // A failed read-only probe is still unknown. Never turn it into another POST.
    }
    return { status: 'unknown', error };
  }
}

export async function readPendingEstimateOverflowStatus({ pending, readStatus } = {}) {
  if (!pending) return { status: 'none' };
  try {
    return classifyOverflowStatusResponse(await readStatus(pending));
  } catch (error) {
    return { status: 'unknown', error };
  }
}
