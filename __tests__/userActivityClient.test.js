const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, describeControl, pathname, startActivityRecorder, MAX_QUEUE } = require('../lib/userActivityClient');
const storage = () => { const map = new Map(); return { get length() { return map.size; }, key: index => [...map.keys()][index], getItem: key => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function element(tag, attrs = {}, text = '') {
  return { tagName: tag, textContent: text, value: 'SECRET INPUT', getAttribute: name => attrs[name] || null, querySelector: () => null, closest(selector) { return selector.startsWith('[data-activity-private]') ? (attrs.private ? this : null) : this; } };
}
test('metadata excludes raw input/containers, private controls and URL queries', () => {
  assert.deepEqual(describeControl(element('INPUT', { type: 'text' })), { control: 'input:text', label: '' });
  assert.equal(describeControl(element('DIV', {}, 'SECRET CUSTOMER')).label, '');
  assert.equal(describeControl(element('BUTTON', {}, ' 저장 ')).label, '저장');
  assert.equal(describeControl(element('BUTTON', { private: true })), null);
  assert.equal(pathname('/orders?customer=secret#password'), '/orders');
});
test('queue survives refresh, deletes only ACK IDs and isolates accounts', () => {
  const s = storage(), a = createQueue(s, 'a'); a.add({ id: 'one' }); a.add({ id: 'two' });
  const restored = createQueue(s, 'a'); restored.ack(['one', 'unknown']);
  assert.deepEqual(restored.batch(), [{ id: 'two' }]); assert.equal(createQueue(s, 'b').status().pending, 0);
});
test('a new tab recovers durable events and ACK does not overwrite concurrent tab additions', () => {
  const s = storage(), a = createQueue(s, 'alice', 'tab-a'); a.add({ id: 'first', sessionId: 'tab-a' });
  const b = createQueue(s, 'alice', 'tab-b'); a.add({ id: 'later', sessionId: 'tab-a' });
  b.ack(['first']); b.add({ id: 'other', sessionId: 'tab-b' });
  assert.deepEqual(createQueue(s, 'alice', 'after-restart').batch().map(e => e.id).sort(), ['later', 'other']);
  assert.equal(createQueue(s, 'bob').batch().length, 0);
});
test('overflow and storage failure are explicit and overflow survives ACK/reload', () => {
  const s = storage(), q = createQueue(s, 'a'); for (let i = 0; i < MAX_QUEUE; i++) q.add({ id: String(i) });
  assert.equal(q.add({ id: 'overflow' }), false); q.ack(['0']); assert.match(createQueue(s, 'a').status().error, /1건/);
  const failed = createQueue({ getItem: () => null, setItem() { throw Error('quota'); } }, 'a'); failed.add({ id: 'a' });
  assert.match(failed.status().error, /저장 실패/); assert.equal(failed.batch().length, 1);
});
function fixture() {
  const events = new Map(), calls = [], handlers = new Map(); let me = 'alice', health = true;
  class XMLHttpRequest {
    constructor() { this.headers = {}; }
    open(...args) { this.openArgs = args; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(...args) { this.sendArgs = args; }
    addEventListener() {}
    abort() { this.aborted = true; }
  }
  const win = { document: { addEventListener: (k, fn) => handlers.set(k, fn), removeEventListener: k => handlers.delete(k) }, sessionStorage: storage(), localStorage: storage(), Headers,
    XMLHttpRequest,
    location: { href: 'https://nenova.test/orders?secret=hide', pathname: '/orders', origin: 'https://nenova.test' }, queueMicrotask, setTimeout,
    addEventListener: (k, fn) => events.set(k, fn), removeEventListener: k => events.delete(k), setInterval: () => 1, clearInterval() {},
    fetch: async (input, init) => { calls.push({ input, init }); if (String(input).includes('?me=1')) return { ok: true, json: async () => ({ userId: me, record: true, health: { ok: health } }) }; return { ok: true, json: async () => ({ acceptedIds: init?.body ? JSON.parse(init.body).events.map(e => e.id) : [] }) }; } };
  return { win, calls, handlers, events, setMe(value) { me = value; }, setHealth(value) { health = value; } };
}
test('sync click correlation preserves Request headers; polling gets no stale action; cleanup', async () => {
  const f = fixture(), original = f.win.fetch, recorder = startActivityRecorder(f.win, () => {}); await turn();
  const event = { type: 'click', eventPhase: 3, target: element('BUTTON', {}, '저장') };
  f.handlers.get('click')(event);
  const request = new Request('https://nenova.test/api/order', { headers: { 'x-original': 'keep' }, method: 'POST', body: 'secret' });
  await f.win.fetch(request); const click = f.calls.at(-1);
  assert.equal(click.input, request); assert.equal(click.init.headers.get('x-original'), 'keep'); assert.ok(click.init.headers.get('x-nenova-action-id'));
  assert.equal(click.init.headers.get('x-nenova-page-path'), '/orders');
  event.eventPhase = 0;
  await f.win.fetch('/api/poll'); assert.equal(f.calls.at(-1).init.headers.get('x-nenova-action-id'), null); assert.ok(f.calls.at(-1).init.headers.get('x-nenova-session-id')); 
  recorder.stop(); assert.equal(f.win.fetch, original); assert.equal(f.handlers.size, 0);
});
test('custom div/SVG, keyboard click once, login exclusion and server health warning', async () => {
  const f = fixture(), statuses = []; f.setHealth(false);
  const r = startActivityRecorder(f.win, status => statuses.push(status)); await turn();
  assert.match(statuses.at(-1).transportError, /서버/);
  f.handlers.get('click')({ type: 'click', detail: 0, target: element('DIV', { 'aria-label': '펼치기' }) });
  const button = element('BUTTON', {}, '저장'); const svg = element('svg'); svg.closest = selector => selector.startsWith('[data-activity-private]') ? null : button;
  f.handlers.get('click')({ type: 'click', target: svg });
  f.win.location.pathname = '/login'; f.handlers.get('change')({ type: 'change', target: element('INPUT', { type: 'password' }) });
  r.retry(); await turn(); const post = f.calls.find(c => c.init?.method === 'POST'); const rows = JSON.parse(post.init.body).events;
  assert.deepEqual(rows.map(e => e.kind), ['navigation', 'click', 'click']);
  assert.equal(rows[1].label, '펼치기'); assert.equal(rows[2].label, '저장');
  r.stop();
});
test('XHR preserves open/send/abort and includes session context without stale click IDs', async () => {
  const f = fixture(), oldOpen = f.win.XMLHttpRequest.prototype.open, r = startActivityRecorder(f.win, () => {}); await turn();
  const xhr = new f.win.XMLHttpRequest(); xhr.open('POST', '/api/save', true, 'user', 'pass');
  const payload = new Uint8Array([1, 2]); xhr.send(payload); xhr.abort();
  assert.deepEqual(xhr.openArgs, ['POST', '/api/save', true, 'user', 'pass']); assert.equal(xhr.sendArgs[0], payload); assert.ok(xhr.aborted);
  assert.ok(xhr.headers['x-nenova-session-id']); assert.equal(xhr.headers['x-nenova-action-id'], undefined);
  const external = new f.win.XMLHttpRequest(); external.open('POST', 'https://external.test/api/upload'); external.send(payload); assert.deepEqual(external.headers, {});
  r.stop(); assert.equal(f.win.XMLHttpRequest.prototype.open, oldOpen);
});
test('logout suspends immediately and only acknowledged batch is removed', async () => {
  const f = fixture(), recorder = startActivityRecorder(f.win, () => {}); await turn();
  f.handlers.get('change')({ type: 'change', target: element('INPUT') });
  recorder.retry(); await turn();
  const post = f.calls.find(c => c.init?.method === 'POST'); const body = JSON.parse(post.init.body);
  assert.equal(body.expectedUserId, 'alice'); assert.equal(body.events[1].kind, 'change'); assert.ok(!post.init.body.includes('SECRET INPUT'));
  f.setMe('bob'); await f.win.fetch('/api/auth/logout', { method: 'POST' }); await turn();
  f.handlers.get('click')({ type: 'click', target: element('BUTTON', {}, '확인') }); recorder.retry(); await turn();
  const latest = f.calls.filter(c => c.init?.method === 'POST' && c.input === '/api/work/activity').at(-1);
  assert.equal(JSON.parse(latest.init.body).expectedUserId, 'bob'); recorder.stop();
});
