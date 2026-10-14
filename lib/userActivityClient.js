// Metadata only. Never collect input values, request bodies, query strings or DOM snapshots.
const ENDPOINT = '/api/work/activity';
const MAX_QUEUE = 2000;
const KEY = 'nenova.activity.v1.';
const uuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3 | 8)).toString(16); });
const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
function pathname(value, origin = 'https://nenova.invalid') {
  try { return new URL(value, origin).pathname.slice(0, 300); } catch { return '/'; }
}
function describeControl(target) {
  const el = target?.nodeType === 3 ? target.parentElement : target;
  if (!el?.getAttribute || el.closest('[data-activity-private], input[type="password"]')) return null;
  const control = el.closest('button,a,input,select,textarea,[role="button"],[role="checkbox"]') || el;
  const tag = String(control.tagName || '').toLowerCase();
  // textContent of arbitrary cells/containers can contain customer data or pasted messages.
  const label = clean(control.getAttribute('aria-label') || (tag === 'button' && !control.querySelector('input,textarea,[contenteditable],[data-activity-private]') ? control.textContent : ''));
  return { control: clean(tag + (control.getAttribute('type') ? ':' + control.getAttribute('type') : '')), label };
}
function createQueue(storage, userId, sessionId = 'test') {
  // One immutable storage key per event prevents two tabs overwriting each other's
  // queues. Any next authenticated tab can recover this account's pending events.
  const prefix = KEY + encodeURIComponent(userId) + '.event.';
  const overflowKey = KEY + encodeURIComponent(userId) + '.overflow.' + sessionId;
  const events = new Map(), keys = new Map(); let error = '', omitted = 0;
  const restore = () => {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) {
          const event = JSON.parse(storage.getItem(key));
          if (event?.id) { events.set(event.id, event); keys.set(event.id, key); }
        }
      }
      omitted = Math.max(omitted, Number(storage.getItem(overflowKey)) || 0);
    } catch { error = '작업 기록 임시 저장소를 읽지 못했습니다.'; }
  };
  restore();
  return {
    add(event) {
      if (events.size >= MAX_QUEUE) {
        omitted++;
        try { storage.setItem(overflowKey, String(omitted)); } catch { error = '작업 기록 임시 저장 실패: 이 창을 닫지 마세요.'; }
        return false;
      }
      events.set(event.id, event); const key = prefix + sessionId + '.' + event.id; keys.set(event.id, key);
      try { storage.setItem(key, JSON.stringify(event)); error = ''; } catch { error = '작업 기록 임시 저장 실패: 이 창을 닫지 마세요.'; }
      return true;
    },
    ack(ids) {
      for (const id of ids) {
        if (!events.has(id)) continue;
        try { storage.removeItem(keys.get(id)); } catch { error = '전송된 작업 기록의 임시 저장 정리에 실패했습니다.'; continue; }
        events.delete(id); keys.delete(id);
      }
    },
    batch() { restore(); return [...events.values()].slice(0, 50); },
    status() { return { pending: events.size, error: error || (omitted ? '작업 기록 보관 한도 초과로 ' + omitted + '건을 기록하지 못했습니다. 관리자에게 알려주세요.' : '') }; },
  };
}
function startActivityRecorder(win, onStatus) {
  const doc = win.document, originalFetch = win.fetch, XHR = win.XMLHttpRequest;
  let alive = true, identity = null, queue = null, pendingAction = null, flushing = false, checking = false, generation = 0;
  let sessionId;
  try { sessionId = win.sessionStorage.getItem(KEY + 'session') || uuid(); win.sessionStorage.setItem(KEY + 'session', sessionId); } catch { sessionId = uuid(); }
  let transportError = '', serverError = '';
  const status = () => alive && onStatus({ ...(queue?.status() || { pending: 0 }), transportError: serverError || transportError });
  const suspend = () => { generation++; identity = null; queue = null; pendingAction = null; };
  const identify = async () => {
    if (checking || !alive) return;
    checking = true; const token = generation;
    try {
      const response = await originalFetch.call(win, ENDPOINT + '?me=1', { cache: 'no-store', credentials: 'same-origin' });
      const me = response.ok ? await response.json() : null;
      if (!alive || token !== generation) return;
      if (!me?.record || !me.userId) { suspend(); return; }
      if (identity !== String(me.userId)) {
        identity = String(me.userId); queue = createQueue(win.localStorage, identity, sessionId);
        record('navigation', { control: 'page', label: '' });
      }
      serverError = me.health?.ok === false || me.health?.healthy === false ? '서버 작업 기록 저장에 문제가 있습니다. 관리자에게 알려주세요.' : me.health?.disk?.warning ? '작업 기록 저장 공간을 확인해야 합니다. 관리자에게 알려주세요.' : '';
      if (transportError === '작업 기록 연결을 확인하지 못했습니다.') transportError = '';
    } catch { transportError = '작업 기록 연결을 확인하지 못했습니다.'; }
    finally { checking = false; status(); }
  };
  const record = (kind, control) => {
    if (!identity || !queue || !control || win.location.pathname === '/login') return null;
    const actionId = uuid();
    queue.add({ id: uuid(), clientAt: new Date().toISOString(), kind, path: pathname(win.location.href), ...control, actionId, sessionId }); status();
    return actionId;
  };
  const interact = event => {
    const actionId = record(event.type, describeControl(event.target));
    if (actionId) {
      const action = { actionId, sessionId, path: pathname(win.location.href), event };
      pendingAction = action;
      // Only synchronous event handlers share the action; timers/polling do not inherit it.
      // Native browsers may drain microtasks between capture and React's bubble
      // listener. eventPhase guards the dispatch itself; timers cannot inherit it.
      win.setTimeout(() => { if (pendingAction === action) pendingAction = null; }, 0);
    }
  };
  const requestPath = input => { try { const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, win.location.href); return url.origin === win.location.origin ? url.pathname : ''; } catch { return ''; } };
  const authPath = path => /^\/api\/auth\/(login|logout)(?:\/|$)/.test(path);
  const headersFor = (headers, action) => {
    const next = new win.Headers(headers);
    if (action?.actionId) next.set('x-nenova-action-id', action.actionId);
    else next.delete('x-nenova-action-id');
    next.set('x-nenova-session-id', sessionId); next.set('x-nenova-page-path', pathname(win.location.href));
    return next;
  };
  const wrappedFetch = function(input, init) {
    const path = requestPath(input), auth = authPath(path), action = pendingAction?.event.eventPhase ? pendingAction : null;
    if (auth) suspend();
    let options = init;
    if (path.startsWith('/api/') && path !== ENDPOINT && !auth) {
      options = { ...init, headers: headersFor(init?.headers === undefined ? input?.headers : init.headers, action) };
    }
    const result = originalFetch.call(this, input, options);
    if (auth) result.then(() => identify(), () => identify());
    return result;
  };
  const oldOpen = XHR?.prototype.open, oldSend = XHR?.prototype.send;
  const xhrPaths = new WeakMap();
  const wrappedOpen = function(method, url, ...rest) { xhrPaths.set(this, requestPath(String(url))); return oldOpen.call(this, method, url, ...rest); };
  const wrappedSend = function(...args) {
    const path = xhrPaths.get(this) || '', auth = authPath(path);
    if (auth) { suspend(); this.addEventListener('loadend', identify, { once: true }); }
    if (path.startsWith('/api/') && path !== ENDPOINT && !auth) {
      for (const [key, value] of headersFor(undefined, pendingAction?.event.eventPhase ? pendingAction : null)) this.setRequestHeader(key, value);
    }
    return oldSend.apply(this, args);
  };
  const flush = async (keepalive = false) => {
    if (flushing || !identity || !queue?.batch().length) return;
    flushing = true; const owner = identity, ownerQueue = queue;
    try {
      const response = await originalFetch.call(win, ENDPOINT, { method: 'POST', credentials: 'same-origin', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedUserId: owner, events: ownerQueue.batch() }) });
      if (!response.ok) { if ([401, 403, 409].includes(response.status)) { suspend(); identify(); } throw new Error('delivery'); }
      const result = await response.json();
      if (!Array.isArray(result.acceptedIds)) throw new Error('ack');
      ownerQueue.ack(result.acceptedIds); transportError = '';
    } catch { transportError = '작업 기록 전송 보류: 연결 복구 후 자동 재전송합니다.'; }
    finally { flushing = false; status(); }
  };
  const navigate = () => { if (win.location.pathname === '/login') suspend(); else { record('navigation', { control: 'page', label: '' }); identify(); } };
  const pagehide = () => flush(true);
  win.fetch = wrappedFetch;
  if (XHR) { XHR.prototype.open = wrappedOpen; XHR.prototype.send = wrappedSend; }
  ['click', 'change', 'submit'].forEach(name => doc.addEventListener(name, interact, true));
  win.addEventListener('pagehide', pagehide); win.addEventListener('online', identify); win.addEventListener('focus', identify);
  const timer = win.setInterval(() => { identify(); flush(); }, 5000);
  identify();
  return { navigate, retry: () => { identify(); flush(); }, stop() {
    flush(true); alive = false;
    win.clearInterval(timer); ['click', 'change', 'submit'].forEach(name => doc.removeEventListener(name, interact, true));
    win.removeEventListener('pagehide', pagehide); win.removeEventListener('online', identify); win.removeEventListener('focus', identify);
    if (win.fetch === wrappedFetch) win.fetch = originalFetch;
    if (XHR?.prototype.open === wrappedOpen) XHR.prototype.open = oldOpen;
    if (XHR?.prototype.send === wrappedSend) XHR.prototype.send = oldSend;
  } };
}
module.exports = { describeControl, pathname, createQueue, startActivityRecorder, MAX_QUEUE };
