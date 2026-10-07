'use strict';

const PASTE_WORKSPACE_VERSION = 1;
const SNAPSHOT_SCOPE = 'nenova.orders.paste.workspace';

const TOP_LEVEL_FIELDS = new Set([
  'pasteText', 'rawInput', 'inputText', 'excludedLines', 'excludedItems', 'excludedInputLines',
  'pasteExcludedLines', 'baseStockExcludedLines', 'orders', 'manualMatches', 'evidenceMessages',
  'baseInput', 'remainInput', 'baseMatches', 'baseStockText', 'remainStockText',
  'baseStockMatches', 'stockBaseWeek', 'bulkResult',
]);

const BLOCKED_KEY = /(?:^|[_-])(edit.?guard|token|digest|lease|presence|registered.?orders|shipment.?qtys?|saving|controller)(?:$|[_-])/i;
const BLOCKED_KEY_WHOLE = /^(?:editGuard|editGuardState|accessToken|authToken|token|digest|lease|leaseId|presence|presenceState|registeredOrders|shipmentQtys|saving|controller|abortController)$/i;

function isBlockedKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return BLOCKED_KEY_WHOLE.test(key) || BLOCKED_KEY.test(key) ||
    /(?:editguard|token|digest|lease|presence|registeredorders|shipmentqtys?|saving|controller)/i.test(normalized);
}

function canonicalActorId(actorId) {
  if (typeof actorId !== 'string' && typeof actorId !== 'number') return null;
  const value = String(actorId).trim();
  return value && value.length <= 200 ? value : null;
}

function canonicalWeek(week) {
  if (typeof week !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNo = Number(match[2]);
  const sequence = Number(match[3]);
  if (year < 2000 || year > 2200 || weekNo < 1 || weekNo > 53 || sequence < 1 || sequence > 99) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function buildPasteWorkspaceKey(actorId, week) {
  const actor = canonicalActorId(actorId);
  const canonical = canonicalWeek(week);
  if (!actor || !canonical) return null;
  return `nenova:orders-paste:workspace:v${PASTE_WORKSPACE_VERSION}:${encodeURIComponent(actor)}:${canonical}`;
}

function buildPasteWorkspaceLastWeekKey(actorId) {
  const actor = canonicalActorId(actorId);
  return actor ? `nenova:orders-paste:last-week:v${PASTE_WORKSPACE_VERSION}:${encodeURIComponent(actor)}` : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      if (!isBlockedKey(key)) out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'function' || typeof value === 'undefined') return null;
  return value;
}

function buildPasteWorkspaceFingerprint({ week, pasteText, orders, evidenceMessages = [] } = {}) {
  const canonical = canonicalWeek(week);
  if (!canonical || typeof pasteText !== 'string' || !Array.isArray(orders) || !Array.isArray(evidenceMessages)) return null;
  const sourceIdentities = [...new Set(evidenceMessages
    .map((message) => message && typeof message.identity === 'string' ? message.identity.trim() : '')
    .filter((identity) => identity.length > 0 && identity.length <= 512))].sort();
  const intentOrders = orders.map((order) => ({
    id: order?.id ?? null,
    custMatch: order?.custMatch ? {
      CustKey: order.custMatch.CustKey ?? null,
      CustName: order.custMatch.CustName ?? null,
    } : null,
    items: (Array.isArray(order?.items) ? order.items : []).map((item) => {
      const intent = {};
      Object.keys(item || {}).filter((key) => /inputname|prodkey|match|unit|action|skip|qty|quantity|expression|expr/i.test(key) && !isBlockedKey(key)).forEach((key) => {
        intent[key] = item[key];
      });
      [
        'inputName', 'prodKey', 'prodName', 'displayName', 'qty', 'unit', 'action', 'skip',
        'mixedQty', 'mixedQuantity', 'quantityExpression', 'qtyExpression', 'qtyExpr',
        'mixedQtyExpression', 'quantityParts', 'qtyParts', 'manualMatch', 'mappingMatchType',
      ].forEach((key) => { if (Object.prototype.hasOwnProperty.call(item || {}, key)) intent[key] = item[key]; });
      return stableValue(intent);
    }),
  }));
  return JSON.stringify(stableValue({ version: PASTE_WORKSPACE_VERSION, week: canonical, pasteText, sourceIdentities, orders: intentOrders }));
}

function sanitize(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.map((item) => sanitize(item, seen)).filter((item) => item !== undefined);
    seen.delete(value);
    return out;
  }
  const out = {};
  Object.keys(value).forEach((key) => {
    if (isBlockedKey(key)) return;
    const next = sanitize(value[key], seen);
    if (next !== undefined) out[key] = next;
  });
  seen.delete(value);
  return out;
}

function isVerifiedSuccessfulBulkResult(result) {
  if (!result || typeof result !== 'object' || result.verified !== true || result.orderId !== 'ALL' || !Array.isArray(result.details) || result.details.length === 0) return false;
  const ok = Number(result.okCount);
  const fail = Number(result.failCount);
  return Number.isFinite(ok) && ok > 0 && Number.isFinite(fail) && fail === 0 &&
    Number.isInteger(ok) && result.details.length === ok &&
    result.rolledBack !== true && result.undone !== true &&
    result.details.every((row) => row && row.ok === true);
}

function validatePasteWorkspace(snapshot, { actorId, week } = {}) {
  const key = buildPasteWorkspaceKey(actorId, week);
  const actor = canonicalActorId(actorId);
  const canonical = canonicalWeek(week);
  if (!key || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  return snapshot.scope === SNAPSHOT_SCOPE && snapshot.version === PASTE_WORKSPACE_VERSION &&
    snapshot.actorId === actor && snapshot.week === canonical &&
    snapshot.state && typeof snapshot.state === 'object' &&
    typeof snapshot.state.pasteText === 'string' && Array.isArray(snapshot.state.orders);
}

function savePasteWorkspace(storage, { actorId, week, state, completionFingerprint } = {}) {
  const key = buildPasteWorkspaceKey(actorId, week);
  const lastWeekKey = buildPasteWorkspaceLastWeekKey(actorId);
  const actor = canonicalActorId(actorId);
  const canonical = canonicalWeek(week);
  if (!key || !lastWeekKey || !state || typeof state !== 'object' || typeof state.pasteText !== 'string' || !Array.isArray(state.orders)) {
    throw new TypeError('붙여넣기 작업공간의 업체 사용자 ID, 차수 또는 상태가 올바르지 않습니다.');
  }
  if (!storage || typeof storage.setItem !== 'function') throw new TypeError('작업공간 저장소를 사용할 수 없습니다.');

  const snapshot = {
    scope: SNAPSHOT_SCOPE,
    version: PASTE_WORKSPACE_VERSION,
    actorId: actor,
    week: canonical,
  };
  const savedState = {};
  TOP_LEVEL_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(state, field)) return;
    if (field === 'bulkResult') {
      return;
    }
    savedState[field] = sanitize(state[field]);
  });
  if (typeof savedState.pasteText !== 'string' || !Array.isArray(savedState.orders)) {
    throw new TypeError('작업공간에는 붙여넣기 원문과 주문 목록이 필요합니다.');
  }
  const intentFingerprint = buildPasteWorkspaceFingerprint({ week: canonical, pasteText: savedState.pasteText, orders: savedState.orders, evidenceMessages: savedState.evidenceMessages || [] });
  snapshot.intentFingerprint = intentFingerprint;
  if (isVerifiedSuccessfulBulkResult(state.bulkResult) && typeof completionFingerprint === 'string' &&
      completionFingerprint && completionFingerprint === intentFingerprint) {
    const result = sanitize(state.bulkResult);
    savedState.bulkResult = result;
    snapshot.completionFingerprint = completionFingerprint;
  }
  snapshot.state = savedState;
  storage.setItem(key, JSON.stringify(snapshot));
  storage.setItem(lastWeekKey, canonical);
  return snapshot;
}

function loadPasteWorkspace(storage, { actorId, week, currentFingerprint } = {}) {
  const selectedWeek = week || loadPasteWorkspaceLastWeek(storage, actorId);
  const key = buildPasteWorkspaceKey(actorId, selectedWeek);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  const serialized = storage.getItem(key);
  if (!serialized) return null;
  let snapshot;
  try { snapshot = JSON.parse(serialized); } catch { return null; }
  if (!validatePasteWorkspace(snapshot, { actorId, week: selectedWeek })) return null;
  const actualFingerprint = buildPasteWorkspaceFingerprint({ week: snapshot.week, pasteText: snapshot.state.pasteText, orders: snapshot.state.orders, evidenceMessages: snapshot.state.evidenceMessages || [] });
  if (snapshot.intentFingerprint !== actualFingerprint) return null;
  const completionMatches = isVerifiedSuccessfulBulkResult(snapshot.state.bulkResult) &&
    snapshot.completionFingerprint === actualFingerprint &&
    (currentFingerprint == null || currentFingerprint === actualFingerprint);
  if (snapshot.state.bulkResult && !completionMatches) {
    delete snapshot.state.bulkResult;
    delete snapshot.completionFingerprint;
    snapshot.state.orders = snapshot.state.orders.map((order) => ({ ...order, distributionCompleted: false }));
  }
  snapshot.week = selectedWeek;
  return snapshot;
}

function loadPasteWorkspaceLastWeek(storage, actorId) {
  const key = buildPasteWorkspaceLastWeekKey(actorId);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  const week = storage.getItem(key);
  return canonicalWeek(week) ? week : null;
}

module.exports = {
  PASTE_WORKSPACE_VERSION,
  SNAPSHOT_SCOPE,
  buildPasteWorkspaceKey,
  buildPasteWorkspaceLastWeekKey,
  buildPasteWorkspaceFingerprint,
  validatePasteWorkspace,
  savePasteWorkspace,
  loadPasteWorkspace,
  loadPasteWorkspaceLastWeek,
};
