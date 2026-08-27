const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const RECOVERY_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export const ESTIMATE_SAVE_RECOVERY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000];
export const ESTIMATE_EDIT_DRAFT_PREFIX = 'nenova.estimate.edit-draft.v1';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameNumber(left, right, tolerance = 0.001) {
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  return a != null && b != null && Math.abs(a - b) <= tolerance;
}

export function isTransientEstimateSaveFailure(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
  if (RECOVERY_ERROR_CODES.has(String(error?.code || ''))) return true;
  if (error?.name === 'AbortError' && status === 0) return true;
  // Browser fetch rejects network disconnects with TypeError. Business/API
  // errors in this project are normal Error objects carrying status/code.
  return error?.name === 'TypeError' && status === 0 && !error?.code;
}

export function estimateEditDraftKey({ orderYear, parentWeek, custKey } = {}) {
  const year = String(orderYear || '').trim();
  const week = String(parentWeek || '').trim().padStart(2, '0');
  const customer = Number(custKey);
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(week) || !Number.isInteger(customer) || customer <= 0) return '';
  return `${ESTIMATE_EDIT_DRAFT_PREFIX}.${year}.${week}.${customer}`;
}

export function readEstimateEditDraft(storage, scope) {
  const key = estimateEditDraftKey(scope);
  if (!key || !storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (!parsed || parsed.version !== 1 || parsed.scopeKey !== key) return null;
    return {
      costEdits: parsed.costEdits && typeof parsed.costEdits === 'object' ? parsed.costEdits : {},
      qtyEdits: parsed.qtyEdits && typeof parsed.qtyEdits === 'object' ? parsed.qtyEdits : {},
      costMode: ['once', 'fixed', 'weekFav'].includes(parsed.costMode) ? parsed.costMode : 'once',
      updatedAt: Number(parsed.updatedAt || 0),
    };
  } catch {
    return null;
  }
}

export function writeEstimateEditDraft(storage, scope, draft = {}) {
  const key = estimateEditDraftKey(scope);
  if (!key || !storage) return false;
  const costEdits = draft.costEdits && typeof draft.costEdits === 'object' ? draft.costEdits : {};
  const qtyEdits = draft.qtyEdits && typeof draft.qtyEdits === 'object' ? draft.qtyEdits : {};
  try {
    if (Object.keys(costEdits).length === 0 && Object.keys(qtyEdits).length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify({
      version: 1,
      scopeKey: key,
      costEdits,
      qtyEdits,
      costMode: ['once', 'fixed', 'weekFav'].includes(draft.costMode) ? draft.costMode : 'once',
      updatedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

function rowForIntent(rows, intent) {
  if (intent.kind === 'estimate') {
    return rows.find((row) => Number(row.EstimateKey) === Number(intent.key) && row.SdetailKey == null) || null;
  }
  if (intent.kind === 'date') {
    return rows.find((row) => Number(row.SdateKey) === Number(intent.key)) || null;
  }
  if (intent.kind === 'detail') {
    return rows.find((row) => Number(row.SdetailKey) === Number(intent.key) && row.EstimateKey == null) || null;
  }
  return null;
}

function currentValue(row, intent) {
  if (!row) return null;
  if (intent.field === 'quantity') return row.Quantity;
  if (intent.kind === 'date' && row.DateCost != null) return row.DateCost;
  return row.Cost;
}

export function classifyEstimateSaveSnapshot({ intents = [], rows = [] } = {}) {
  if (!Array.isArray(intents) || intents.length === 0) return { status: 'conflict', matches: [] };
  const matches = intents.map((intent) => {
    const row = rowForIntent(rows, intent);
    if (!row && intent.field === 'quantity' && sameNumber(intent.desired, 0)) {
      return { intent, row: null, state: 'applied' };
    }
    const current = currentValue(row, intent);
    if (sameNumber(current, intent.desired)) return { intent, row, state: 'applied', current: Number(current) };
    if (sameNumber(current, intent.expected)) return { intent, row, state: 'unchanged', current: Number(current) };
    return { intent, row, state: 'conflict', current: finiteNumber(current) };
  });
  const states = new Set(matches.map((entry) => entry.state));
  if (states.size === 1 && states.has('applied')) return { status: 'applied', matches };
  if (states.size === 1 && states.has('unchanged')) return { status: 'unchanged', matches };
  return { status: 'conflict', matches };
}

function recoveryError(code, message, cause) {
  return Object.assign(new Error(message), { code, cause });
}

export async function waitForEstimateServer({ probe, delays = ESTIMATE_SAVE_RECOVERY_DELAYS_MS, onState = () => {} } = {}) {
  let lastError = null;
  for (let index = 0; index < delays.length; index += 1) {
    const delayMs = Math.max(0, Number(delays[index]) || 0);
    onState({ phase: 'waiting', attempt: index + 1, delayMs });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const healthy = await probe();
      if (healthy) return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw recoveryError('ESTIMATE_SERVER_RECOVERY_TIMEOUT', '서버 연결이 복구되지 않았습니다. 입력값은 그대로 보관했습니다.', lastError);
}

export async function runRecoverableEstimateSave({
  request,
  reconcile,
  probe,
  onState = () => {},
  delays = ESTIMATE_SAVE_RECOVERY_DELAYS_MS,
  maxRequests = 2,
} = {}) {
  let lastTransientError = null;
  for (let requestNo = 1; requestNo <= maxRequests; requestNo += 1) {
    try {
      return { data: await request(requestNo), recovered: requestNo > 1, alreadyApplied: false };
    } catch (error) {
      if (!isTransientEstimateSaveFailure(error)) throw error;
      lastTransientError = error;
      onState({ phase: 'server-updating', requestNo, error });
      await waitForEstimateServer({ probe, delays, onState });
      let snapshot;
      for (let reconcileAttempt = 1; reconcileAttempt <= 3; reconcileAttempt += 1) {
        try {
          snapshot = await reconcile();
          break;
        } catch (reconcileError) {
          if (!isTransientEstimateSaveFailure(reconcileError) || reconcileAttempt === 3) throw reconcileError;
          onState({ phase: 'server-updating', requestNo, reconcileAttempt, error: reconcileError });
          await waitForEstimateServer({ probe, delays, onState });
        }
      }
      if (snapshot?.status === 'applied') {
        onState({ phase: 'already-applied', requestNo, snapshot });
        return { data: snapshot.data || {}, recovered: true, alreadyApplied: true, snapshot };
      }
      if (snapshot?.status !== 'unchanged') {
        throw recoveryError(
          'ESTIMATE_SAVE_RECOVERY_CONFLICT',
          '서버 복구 후 값이 입력 전·후 어느 쪽과도 일치하지 않습니다. 입력값은 보관했으며 자동 재처리를 중단했습니다.',
          error,
        );
      }
      if (requestNo < maxRequests) onState({ phase: 'retrying', requestNo: requestNo + 1, snapshot });
    }
  }
  throw recoveryError('ESTIMATE_SAVE_RETRY_EXHAUSTED', '서버 복구 후 자동 재처리를 완료하지 못했습니다. 입력값은 그대로 보관했습니다.', lastTransientError);
}
