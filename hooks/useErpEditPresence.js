import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const HEARTBEAT_MS = 20_000;
const POLL_MS = 8_000;
const PRESENCE_REQUEST_TIMEOUT_MS = 20_000;
const CLIENT_ID_KEY = 'nenova.erp.edit.client-id';

function makeClientId() {
  if (typeof window === 'undefined') return 'server-render';
  try {
    const saved = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const next = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function requestPresence(method, payload) {
  const query = method === 'GET'
    ? `?${new URLSearchParams(Object.entries(payload).filter(([, value]) => value != null && value !== '')).toString()}`
    : '';
  const response = await fetch(`/api/erp/edit-presence${query}`, {
    method,
    credentials: 'same-origin',
    ...(method === 'GET' ? { cache: 'no-store' } : {}),
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(PRESENCE_REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error || '작업 상태를 확인하지 못했습니다.');
    error.code = data.code || (response.status === 409 ? 'ERP_EDIT_LOCKED' : 'ERP_EDIT_PRESENCE_ERROR');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function emptyState() {
  return { loading: false, active: false, ownedByMe: false, ownedBySameUser: false, stale: false, error: '', digest: '', fixStatusDigest: '', fixStatusChanged: false, token: '', revision: 0, ownerName: '', pageCode: '', expiresAt: '', scopeKey: '' };
}

// Keep this reducer pure so the save-completion transition can be exercised
// without mounting React.  A successful own write advances the lease baseline
// inside the ERP transaction; heartbeat then returns stale=false with that
// exact baseline.  An EXE/other-window write after our commit returns
// stale=true and must never be accepted as another own write.
export function mergeErpEditPresenceResponse(previous = {}, data = {}, { preserveToken = true } = {}) {
  const lease = data?.lease || {};
  const nextFixStatusDigest = data?.fixStatusDigest || previous.fixStatusDigest || '';
  const nextRevision = Object.prototype.hasOwnProperty.call(lease, 'revision')
    ? Number(lease.revision || 0)
    : Number(previous.revision || 0);
  return {
    ...previous,
    loading: false,
    error: '',
    active: Boolean(lease.active),
    ownedByMe: Boolean(lease.ownedByMe),
    ownedBySameUser: Boolean(lease.ownedBySameUser),
    ownerName: lease.ownerName || '',
    pageCode: lease.pageCode || '',
    expiresAt: lease.expiresAt || '',
    digest: data?.digest || previous.digest || '',
    fixStatusDigest: nextFixStatusDigest,
    fixStatusChanged: Boolean(previous.fixStatusDigest && nextFixStatusDigest && previous.fixStatusDigest !== nextFixStatusDigest),
    token: lease.token || (preserveToken ? previous.token : ''),
    revision: nextRevision,
    stale: Boolean(data?.stale),
    scopeKey: editScopeKey(data?.scope || {}),
  };
}

export function mergeCurrentErpEditPresenceResponse(previous = {}, data = {}, { preserveToken = true, allowStaleClear = false } = {}) {
  const next = mergeErpEditPresenceResponse(previous, data, { preserveToken });
  // Automatic equal-revision responses cannot clear a real external-change
  // warning. Explicit refresh/takeover or a newer transaction revision can.
  if (previous.stale && !next.stale && previous.scopeKey && previous.scopeKey === next.scopeKey
    && Number(next.revision || 0) <= Number(previous.revision || 0) && !allowStaleClear) {
    next.stale = true;
  }
  return next;
}

function responseRevision(data = {}) {
  if (!Object.prototype.hasOwnProperty.call(data?.lease || {}, 'revision')) return null;
  const revision = Number(data.lease.revision);
  return Number.isFinite(revision) ? revision : null;
}

// Background status requests overlap by design. Keep their ordering policy
// pure so delayed pre-save/past-scope responses can be exercised without a
// browser harness. Server revision is authoritative for one owned lease;
// request sequence resolves equal-revision network reordering.
export function shouldApplyErpPresenceRequest(request = {}, current = {}, data = {}, { allowDuringSave = false, allowTokenChange = false } = {}) {
  if (!request.scopeKey || request.scopeKey !== current.scopeKey) return false;
  if (Number(request.epoch) !== Number(current.epoch)) return false;
  if (Number(request.sequence || 0) < Number(current.appliedSequence || 0)) return false;
  if (request.startedWhileSaving && !allowDuringSave) return false;

  const dataScopeKey = data?.scope ? editScopeKey(data.scope) : '';
  if (dataScopeKey && dataScopeKey !== current.scopeKey) return false;

  const currentToken = String(current.token || '');
  const requestToken = String(request.token || '');
  if (!allowTokenChange && requestToken && currentToken && requestToken !== currentToken) return false;

  const nextRevision = responseRevision(data);
  const currentRevision = Number(current.revision || 0);
  if (!allowTokenChange && nextRevision != null && nextRevision < currentRevision) return false;
  return true;
}

export function createErpPresenceRequestCoordinator() {
  let epoch = 0;
  let sequence = 0;
  let appliedSequence = 0;
  let scopeKey = '';
  return {
    setScope(nextScopeKey = '') {
      const normalized = String(nextScopeKey || '');
      if (normalized !== scopeKey) {
        scopeKey = normalized;
        epoch += 1;
      }
      return epoch;
    },
    invalidateForSave() {
      epoch += 1;
      return epoch;
    },
    begin({ token = '', savingCount = 0 } = {}) {
      sequence += 1;
      return { epoch, sequence, scopeKey, token: String(token || ''), startedWhileSaving: Number(savingCount || 0) > 0 };
    },
    canApply(request, state = {}, data = {}, options = {}) {
      return shouldApplyErpPresenceRequest(request, {
        epoch,
        appliedSequence,
        scopeKey,
        token: state.scopeKey === scopeKey ? state.token : '',
        revision: state.scopeKey === scopeKey ? state.revision : 0,
      }, data, options);
    },
    markApplied(request) {
      appliedSequence = Math.max(appliedSequence, Number(request?.sequence || 0));
    },
    snapshot() { return { epoch, sequence, appliedSequence, scopeKey }; },
  };
}

// Polling 중 발견한 지문 변경은 외부 수정이므로 저장을 막아야 한다.
// 단, 사용자가 명시적으로 최신 내용을 다시 불러온 경우에는 기존 화면
// 기준을 버리고 현재 ERP 원장을 새 기준으로 받아들인다.
export function shouldBlockErpDigestTransition({ force = false, savingCount = 0, previousDigest = '', nextDigest = '' } = {}) {
  return !force
    && Number(savingCount || 0) === 0
    && Boolean(previousDigest)
    && Boolean(nextDigest)
    && previousDigest !== nextDigest;
}

export function isErpOwnSaveSettlement(previous = {}, data = {}) {
  const lease = data?.lease || {};
  const previousToken = String(previous.token || '');
  const responseToken = String(lease.token || '');
  const previousRevision = Number(previous.revision || 0);
  const nextRevision = responseRevision(data);
  return Boolean(
    previousToken
    && responseToken === previousToken
    && lease.ownedByMe === true
    && data?.stale === false
    && nextRevision != null
    && nextRevision > previousRevision
  );
}

function editScopeKey({ year, orderYear, week, orderWeek, custKey } = {}) {
  const rawWeek = String(orderWeek || week || '').trim();
  const parts = rawWeek.split('-');
  const parentWeek = parts.length === 3 ? parts[1] : parts[0];
  return `${String(orderYear || year || '')}/${parentWeek}/${String(custKey || '')}`;
}

// A reload can meet an active stale lease that belongs to this exact browser.
// Keep the owner-only token returned by the server so an explicit "latest
// contents" action can refresh the baseline.  Never manufacture ownership or
// a token when the server did not return one.
export function mergeErpEditPresenceError(previous = {}, error = {}, scope = {}) {
  const code = error?.code || error?.data?.code || '';
  const lease = error?.data?.lease || null;
  if (code === 'ERP_EDIT_STALE') {
    const responseScope = error?.data?.scope || scope;
    return {
      ...previous,
      loading: false,
      active: lease ? Boolean(lease.active) : Boolean(previous.active),
      ownedByMe: lease ? Boolean(lease.ownedByMe) : Boolean(previous.ownedByMe),
      ownedBySameUser: lease ? Boolean(lease.ownedBySameUser) : Boolean(previous.ownedBySameUser),
      ownerName: lease?.ownerName || previous.ownerName || '',
      pageCode: lease?.pageCode || previous.pageCode || '',
      expiresAt: lease?.expiresAt || previous.expiresAt || '',
      token: lease?.token || previous.token || '',
      revision: Object.prototype.hasOwnProperty.call(lease || {}, 'revision') ? Number(lease.revision || 0) : Number(previous.revision || 0),
      digest: error?.data?.actualDigest || previous.digest || '',
      fixStatusDigest: error?.data?.fixStatusDigest || previous.fixStatusDigest || '',
      scopeKey: editScopeKey(responseScope) || previous.scopeKey || '',
      stale: true,
      error: '',
    };
  }
  return {
    ...previous,
    loading: false,
    error: error?.message || '작업 상태 확인 실패',
  };
}

export function normalizeErpEditClientWeek(week) {
  const rawWeek = String(week || '').trim();
  const parts = rawWeek.split('-');
  return parts.length === 3 ? parts[1] : parts[0];
}

export function getErpEditClientId() {
  return makeClientId();
}

export async function acquireErpEditPresence({ year, week, custKey, pageCode, clientId = makeClientId(), expectedDigest = '' }) {
  return requestPresence('POST', { action: 'acquire', year, week, custKey, pageCode, clientId, expectedDigest });
}

// Explicit user action only. This is intentionally separate from acquire so a
// page can decide when taking over a lease held by the same logged-in user is
// warranted (for example, after the user re-runs paste analysis in a new tab).
// The server still rejects a different user's lease and rotates the token.
export async function takeoverErpEditPresence({ year, week, custKey, pageCode, clientId = makeClientId() }) {
  return requestPresence('POST', { action: 'takeover', year, week, custKey, pageCode, clientId });
}

export async function releaseErpEditPresence({ year, week, custKey, pageCode, clientId = makeClientId(), token }) {
  if (!token) return null;
  return requestPresence('POST', { action: 'release', year, week, custKey, pageCode, clientId, token });
}

export async function refreshErpEditPresence({ year, week, custKey, pageCode, clientId = makeClientId(), token }) {
  if (!token) return null;
  return requestPresence('POST', { action: 'refresh', year, week, custKey, pageCode, clientId, token });
}

export async function heartbeatErpEditPresence({ year, week, custKey, pageCode, clientId = makeClientId(), token }) {
  if (!token) return null;
  return requestPresence('POST', { action: 'heartbeat', year, week, custKey, pageCode, clientId, token });
}

export function editGuardFromPresence(presence, { custKey, pageCode } = {}) {
  return {
    token: presence?.token || '',
    expectedDigest: presence?.digest || '',
    clientId: presence?.clientId || makeClientId(),
    pageCode: pageCode || presence?.pageCode || '',
    custKey: custKey ?? presence?.custKey ?? '',
  };
}

/**
 * 업체·연도·세부차수 단위의 웹 작업 상태. 전산 프로그램은 임대를 알 수 없으므로
 * 8초마다 원장 지문도 확인해 외부 변경을 저장 전에 차단한다.
 */
export default function useErpEditPresence({ year, week, custKey, pageCode, enabled = true } = {}) {
  const clientIdRef = useRef(makeClientId());
  const [state, setState] = useState(emptyState);
  const stateRef = useRef(state);
  const savingRef = useRef(0);
  const requestCoordinatorRef = useRef(null);
  if (!requestCoordinatorRef.current) requestCoordinatorRef.current = createErpPresenceRequestCoordinator();
  const scope = useMemo(() => ({ year: String(year || ''), week: normalizeErpEditClientWeek(week), custKey: custKey == null ? '' : String(custKey || ''), pageCode: String(pageCode || ''), clientId: clientIdRef.current }), [year, week, custKey, pageCode]);
  const validScope = Boolean(enabled && scope.year && scope.week && scope.custKey && scope.pageCode);
  // Ref invalidation happens during render, before the old effect cleanup, so
  // a response from the previous customer can never land in the new scope.
  requestCoordinatorRef.current.setScope(validScope ? editScopeKey(scope) : '');

  useEffect(() => { stateRef.current = state; }, [state]);

  const transitionState = useCallback((updater) => {
    const previous = stateRef.current;
    const next = typeof updater === 'function' ? updater(previous) : updater;
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const beginPresenceRequest = useCallback(() => requestCoordinatorRef.current.begin({
    token: stateRef.current.token,
    savingCount: savingRef.current,
  }), []);

  const claimPresenceResponse = useCallback((request, data, options = {}) => {
    if (!request) return true;
    const coordinator = requestCoordinatorRef.current;
    if (!coordinator.canApply(request, stateRef.current, data, options)) return false;
    coordinator.markApplied(request);
    return true;
  }, []);

  const applyResponse = useCallback((data, { preserveToken = true, request = null, allowDuringSave = false, allowTokenChange = false, allowStaleClear = false, claimed = false } = {}) => {
    if (!claimed && !claimPresenceResponse(request, data, { allowDuringSave, allowTokenChange })) return data;
    const prev = stateRef.current;
    const next = mergeCurrentErpEditPresenceResponse(prev, data, { preserveToken, allowStaleClear });
    transitionState(next);
    return data;
  }, [claimPresenceResponse, transitionState]);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!validScope) return null;
    const request = beginPresenceRequest();
    const requestState = stateRef.current;
    try {
      const data = force && requestState.token
        ? await requestPresence('POST', { action: 'refresh', ...scope, token: requestState.token })
        : await requestPresence('GET', scope);
      if (!claimPresenceResponse(request, data)) return data;
      const previous = stateRef.current;
      const nextDigest = data?.digest || '';
      const ownSaveSettlement = isErpOwnSaveSettlement(previous, data);
      if (!ownSaveSettlement && shouldBlockErpDigestTransition({
        force,
        savingCount: savingRef.current,
        previousDigest: previous.digest,
        nextDigest,
      })) {
        transitionState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
        return data;
      }
      return applyResponse(data, { claimed: true, allowStaleClear: force });
    } catch (error) {
      if (!claimPresenceResponse(request, error?.data || {})) return null;
      if (error.code === 'ERP_EDIT_STALE') {
        transitionState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
      } else if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        transitionState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else {
        transitionState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
      }
      throw error;
    }
  }, [applyResponse, beginPresenceRequest, claimPresenceResponse, scope, transitionState, validScope]);

  const acquire = useCallback(async () => {
    if (!validScope) return null;
    transitionState(prev => ({ ...prev, loading: true, error: '' }));
    const request = beginPresenceRequest();
    try {
      const data = await requestPresence('POST', { action: 'acquire', ...scope });
      return applyResponse(data, { preserveToken: false, request, allowTokenChange: true, allowStaleClear: true });
    } catch (error) {
      if (!claimPresenceResponse(request, error?.data || {}, { allowTokenChange: true })) return null;
      if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        transitionState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else if (error.code === 'ERP_EDIT_STALE') {
        const next = mergeErpEditPresenceError(stateRef.current, error, scope);
        transitionState(next);
      } else {
        transitionState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
      }
      throw error;
    }
  }, [applyResponse, beginPresenceRequest, claimPresenceResponse, scope, transitionState, validScope]);

  const takeover = useCallback(async () => {
    if (!validScope) return null;
    transitionState(prev => ({ ...prev, loading: true, error: '' }));
    const request = beginPresenceRequest();
    try {
      const data = await requestPresence('POST', { action: 'takeover', ...scope });
      return applyResponse(data, { preserveToken: false, request, allowTokenChange: true, allowStaleClear: true });
    } catch (error) {
      if (!claimPresenceResponse(request, error?.data || {}, { allowTokenChange: true })) return null;
      const lease = error.data?.lease || {};
      transitionState(prev => ({
        ...prev,
        loading: false,
        active: Boolean(lease.active),
        ownedByMe: false,
        ownedBySameUser: Boolean(lease.ownedBySameUser),
        ownerName: lease.ownerName || '',
        pageCode: lease.pageCode || '',
        expiresAt: lease.expiresAt || '',
        error: error.code === 'ERP_EDIT_LOCKED' ? '' : (error.message || '작업 넘겨받기 실패'),
      }));
      throw error;
    }
  }, [applyResponse, beginPresenceRequest, claimPresenceResponse, scope, transitionState, validScope]);

  const release = useCallback(async (releaseScope = scope, token = stateRef.current.token) => {
    if (!token || !releaseScope?.year || !releaseScope?.week || !releaseScope?.custKey) return null;
    try { return await releaseErpEditPresence({ ...releaseScope, clientId: clientIdRef.current, token }); }
    catch { return null; }
  }, [scope]);

  useEffect(() => {
    if (!validScope) {
      transitionState(emptyState());
      return undefined;
    }
    let disposed = false;
    let ownedToken = '';
    acquire().then(data => { if (!disposed) ownedToken = data?.lease?.token || ''; }).catch(() => {});
    const heartbeat = setInterval(() => {
      const current = stateRef.current;
      // 저장 중에는 외부 변경 감지 polling만 멈춘다. 임대 연장은 계속해야
      // 확정해제→저장→재확정처럼 오래 걸리는 정상 작업이 자기 임대를 잃지 않는다.
      if (!current.token) return;
      const request = beginPresenceRequest();
      requestPresence('POST', { action: 'heartbeat', ...scope, token: current.token })
        .then(data => { if (!disposed) applyResponse(data, { request }); })
        .catch(error => {
          if (disposed || !claimPresenceResponse(request, error?.data || {})) return;
          if (error.code === 'ERP_EDIT_STALE') transitionState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
          else if (error.code === 'ERP_EDIT_LOCKED') {
            const lease = error.data?.lease || {};
            transitionState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', error: '' }));
          } else transitionState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
        });
    }, HEARTBEAT_MS);
    const poll = setInterval(() => { if (savingRef.current === 0) refresh().catch(() => {}); }, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      // scope가 바뀐 뒤의 새 임대를 잘못 해제하지 않도록, 이 effect가 취득한 토큰만 반납한다.
      release(scope, ownedToken);
    };
  }, [acquire, applyResponse, beginPresenceRequest, claimPresenceResponse, refresh, release, scope, transitionState, validScope]);

  const beginSaving = useCallback(() => {
    // Every save start invalidates requests that observed the pre-save digest.
    // A nested/new save also invalidates an older endSaving heartbeat that is
    // still in flight; only the final current save may settle the baseline.
    requestCoordinatorRef.current.invalidateForSave();
    savingRef.current += 1;
  }, []);
  const endSaving = useCallback(async ({ refreshBaseline = true } = {}) => {
    const shouldVerifyOwnWrite = savingRef.current === 1 && refreshBaseline;
    let request = null;
    try {
      if (shouldVerifyOwnWrite) {
        const current = stateRef.current;
        if (!validScope || !current.token) return;
        // Verify every completed save attempt, including partial writes. A later
        // request can fail after an earlier transaction has already advanced the
        // authoritative baseline. Skipping this heartbeat would make that own
        // write look external when polling resumes.
        // Do not call action=refresh here. refresh means the user explicitly
        // accepts whatever is currently in ERP and can hide an EXE edit that
        // lands immediately after our commit. heartbeat only compares the
        // transaction-advanced server baseline with the live ERP snapshot.
        request = beginPresenceRequest();
        const data = await requestPresence('POST', { action: 'heartbeat', ...scope, token: current.token });
        applyResponse(data, { request, allowDuringSave: true });
      }
    } catch (error) {
      if (request && !claimPresenceResponse(request, error?.data || {}, { allowDuringSave: true })) return;
      if (error.code === 'ERP_EDIT_STALE') {
        transitionState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
      } else if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        transitionState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else {
        transitionState(prev => ({ ...prev, loading: false, error: error.message || '저장 후 작업 상태 확인 실패' }));
      }
    } finally {
      // Keep polling suspended until the authoritative heartbeat has settled;
      // otherwise the old client digest can race the just-committed digest.
      savingRef.current = Math.max(0, savingRef.current - 1);
    }
  }, [applyResponse, beginPresenceRequest, claimPresenceResponse, scope, transitionState, validScope]);
  const markStale = useCallback(() => {
    transitionState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
  }, [transitionState]);
  const editGuard = useMemo(() => editGuardFromPresence({ ...state, clientId: clientIdRef.current, custKey: scope.custKey, pageCode: scope.pageCode }, scope), [scope, state]);
  const locked = state.active && !state.ownedByMe;
  const scopeMatches = Boolean(validScope && state.scopeKey && state.scopeKey === editScopeKey(scope));
  const blocked = !validScope || !scopeMatches || state.loading || locked || state.stale || Boolean(state.error) || !state.token;

  return { ...state, clientId: clientIdRef.current, scope, validScope, scopeMatches, locked, blocked, editGuard, acquire, takeover, release, refresh, beginSaving, endSaving, markStale };
}
