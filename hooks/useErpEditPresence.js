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
  return { loading: false, active: false, ownedByMe: false, ownedBySameUser: false, stale: false, error: '', digest: '', fixStatusDigest: '', fixStatusChanged: false, token: '', ownerName: '', pageCode: '', expiresAt: '', scopeKey: '' };
}

// Keep this reducer pure so the save-completion transition can be exercised
// without mounting React.  A successful own write advances the lease baseline
// inside the ERP transaction; heartbeat then returns stale=false with that
// exact baseline.  An EXE/other-window write after our commit returns
// stale=true and must never be accepted as another own write.
export function mergeErpEditPresenceResponse(previous = {}, data = {}, { preserveToken = true } = {}) {
  const lease = data?.lease || {};
  const nextFixStatusDigest = data?.fixStatusDigest || previous.fixStatusDigest || '';
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
    stale: Boolean(data?.stale),
    scopeKey: editScopeKey(data?.scope || {}),
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
  const scope = useMemo(() => ({ year: String(year || ''), week: normalizeErpEditClientWeek(week), custKey: custKey == null ? '' : String(custKey || ''), pageCode: String(pageCode || ''), clientId: clientIdRef.current }), [year, week, custKey, pageCode]);
  const validScope = Boolean(enabled && scope.year && scope.week && scope.custKey && scope.pageCode);

  useEffect(() => { stateRef.current = state; }, [state]);

  const applyResponse = useCallback((data, { preserveToken = true } = {}) => {
    const prev = stateRef.current;
    const next = mergeErpEditPresenceResponse(prev, data, { preserveToken });
    stateRef.current = next;
    setState(next);
    return data;
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!validScope) return null;
    const previous = stateRef.current;
    try {
      const data = force && previous.token
        ? await requestPresence('POST', { action: 'refresh', ...scope, token: previous.token })
        : await requestPresence('GET', scope);
      const nextDigest = data?.digest || '';
      if (shouldBlockErpDigestTransition({
        force,
        savingCount: savingRef.current,
        previousDigest: previous.digest,
        nextDigest,
      })) {
        setState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
        return data;
      }
      return applyResponse(data);
    } catch (error) {
      if (error.code === 'ERP_EDIT_STALE') {
        setState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
      } else if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        setState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else {
        setState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
      }
      throw error;
    }
  }, [applyResponse, scope, validScope]);

  const acquire = useCallback(async () => {
    if (!validScope) return null;
    setState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await requestPresence('POST', { action: 'acquire', ...scope });
      return applyResponse(data, { preserveToken: false });
    } catch (error) {
      if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        setState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else if (error.code === 'ERP_EDIT_STALE') {
        const next = mergeErpEditPresenceError(stateRef.current, error, scope);
        stateRef.current = next;
        setState(next);
      } else {
        setState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
      }
      throw error;
    }
  }, [applyResponse, scope, validScope]);

  const takeover = useCallback(async () => {
    if (!validScope) return null;
    setState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await requestPresence('POST', { action: 'takeover', ...scope });
      return applyResponse(data, { preserveToken: false });
    } catch (error) {
      const lease = error.data?.lease || {};
      setState(prev => ({
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
  }, [applyResponse, scope, validScope]);

  const release = useCallback(async (releaseScope = scope, token = stateRef.current.token) => {
    if (!token || !releaseScope?.year || !releaseScope?.week || !releaseScope?.custKey) return null;
    try { return await releaseErpEditPresence({ ...releaseScope, clientId: clientIdRef.current, token }); }
    catch { return null; }
  }, [scope]);

  useEffect(() => {
    if (!validScope) {
      setState(emptyState());
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
      requestPresence('POST', { action: 'heartbeat', ...scope, token: current.token })
        .then(data => { if (!disposed) applyResponse(data); })
        .catch(error => {
          if (disposed) return;
          if (error.code === 'ERP_EDIT_STALE') setState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
          else if (error.code === 'ERP_EDIT_LOCKED') {
            const lease = error.data?.lease || {};
            setState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', error: '' }));
          } else setState(prev => ({ ...prev, loading: false, error: error.message || '작업 상태 확인 실패' }));
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
  }, [acquire, applyResponse, refresh, release, scope, validScope]);

  const beginSaving = useCallback(() => { savingRef.current += 1; }, []);
  const endSaving = useCallback(async ({ refreshBaseline = true } = {}) => {
    const shouldVerifyOwnWrite = savingRef.current === 1 && refreshBaseline;
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
        const data = await requestPresence('POST', { action: 'heartbeat', ...scope, token: current.token });
        applyResponse(data);
      }
    } catch (error) {
      if (error.code === 'ERP_EDIT_STALE') {
        setState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
      } else if (error.code === 'ERP_EDIT_LOCKED') {
        const lease = error.data?.lease || {};
        setState(prev => ({ ...prev, loading: false, active: true, ownedByMe: false, ownedBySameUser: Boolean(lease.ownedBySameUser), ownerName: lease.ownerName || '', pageCode: lease.pageCode || '', expiresAt: lease.expiresAt || '', error: '' }));
      } else {
        setState(prev => ({ ...prev, loading: false, error: error.message || '저장 후 작업 상태 확인 실패' }));
      }
    } finally {
      // Keep polling suspended until the authoritative heartbeat has settled;
      // otherwise the old client digest can race the just-committed digest.
      savingRef.current = Math.max(0, savingRef.current - 1);
    }
  }, [applyResponse, scope, validScope]);
  const markStale = useCallback(() => {
    setState(prev => ({ ...prev, loading: false, stale: true, error: '' }));
  }, []);
  const editGuard = useMemo(() => editGuardFromPresence({ ...state, clientId: clientIdRef.current, custKey: scope.custKey, pageCode: scope.pageCode }, scope), [scope, state]);
  const locked = state.active && !state.ownedByMe;
  const scopeMatches = Boolean(validScope && state.scopeKey && state.scopeKey === editScopeKey(scope));
  const blocked = !validScope || !scopeMatches || state.loading || locked || state.stale || Boolean(state.error) || !state.token;

  return { ...state, clientId: clientIdRef.current, scope, validScope, scopeMatches, locked, blocked, editGuard, acquire, takeover, release, refresh, beginSaving, endSaving, markStale };
}
