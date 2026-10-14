const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const store = require('../lib/userActivityStore.cjs');
const { attachRequestAudit, retryPending } = require('../lib/userActivityHttp.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-activity-test-'));
process.env.NENOVA_ACTIVITY_DIR = directory;
const user = { userId: 'nenovaSS3', userName: '관리자' };
const id = randomUUID();
(async () => {
try {
  const event = { id, kind: 'click', path: '/orders?token=SECRET#SECRET', label: '저장', input: 'SECRET', password: 'SECRET', userId: 'forged', source: 'desktop' };
  assert.equal(store.appendEvents(user, [event], 'web').written, 1);
  assert.deepEqual(store.appendEvents(user, [event], 'desktop').acceptedIds, [id]);
  assert.equal((await store.listEvents()).items.length, 1);
  const row = (await store.listEvents()).items[0];
  assert.equal(row.userId, user.userId); assert.equal(row.source, 'web');
  assert.equal(row.path, '/orders'); assert.equal(row.recordedBy, 'client');
  assert.ok(!JSON.stringify(row).includes('SECRET'));
  assert.throws(() => store.appendEvents(user, Array(51).fill(event), 'web'), /INVALID_BATCH/);
  assert.throws(() => store.appendEvents(user, [{ ...event, id: '../escape' }], 'web'), /INVALID_EVENT/);
  await assert.rejects(() => store.listEvents({ from: '2026-01-01', to: '2026-03-01' }), /INVALID_DATE_RANGE/);
  await assert.rejects(() => store.listEvents({ date: '2026-99-99' }), /INVALID_DATE_RANGE/);
  assert.equal(store.sourceFromRequest({ headers: { 'user-agent': 'NenovaDesktop/1.4.0' } }), 'desktop');
  const code = `require(${JSON.stringify(path.resolve(__dirname, '../lib/userActivityStore.cjs'))}).appendEvents(${JSON.stringify(user)},[${JSON.stringify(event)}],'web')`;
  const child = spawnSync(process.execPath, ['-e', code], { env: process.env });
  assert.equal(child.status, 0); assert.equal((await store.listEvents()).items.length, 1);
  for (const scenario of ['false200', 'closed', 'success']) {
    const res = new EventEmitter(); res.statusCode = 200; res.json = function () { return this; };
    const req = { url: '/api/test?secret=SECRET', method: 'POST', headers: {} };
    attachRequestAudit(req, res, user); attachRequestAudit(req, res, user);
    res.json(scenario === 'false200' ? { success: false, secret: 'SECRET' } : { success: true });
    res.emit(scenario === 'closed' ? 'close' : 'finish'); res.emit('close');
  }
  const api = (await store.listEvents({ kind: 'api' })).items;
  assert.equal(api.length, 3); assert.equal(api.filter(r => r.outcome === 'failure').length, 2);
  assert.ok(api.every(r => r.recordedBy === 'server' && r.path === '/api/test'));
  const first = await store.listEvents({ limit: 2 }); const second = await store.listEvents({ limit: 2, cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...second.items].map(r => r.id)).size, 4);
  const res = new EventEmitter(); res.statusCode = 200;
  attachRequestAudit({ url: '/api/work/activity?me=1', method: 'GET', headers: {} }, res, user);
  res.emit('finish'); assert.equal((await store.listEvents()).items.length, 4);
  const late = new EventEmitter(); late.statusCode = 200;
  const lateReq = { url: '/api/auth/login', method: 'POST', headers: {} };
  attachRequestAudit(lateReq, late, { userId: 'anonymous' });
  late.json = function () { return this; };
  attachRequestAudit(lateReq, late, user); late.json({ success: true }); late.emit('finish');
  const login = (await store.listEvents({ path: '/api/auth/login' })).items;
  assert.equal(login.length, 1); assert.equal(login[0].userId, user.userId); assert.equal(login[0].outcome, 'success');
  assert.equal((await store.listEvents({ hour: (new Date().getUTCHours() + 9) % 24 })).items.length, 5);
  await assert.rejects(() => store.listEvents({ hour: '24' }), /INVALID_HOUR/);
  const midnightId = randomUUID();
  store.appendEvents(user, [{ id: midnightId, kind: 'click', path: '/midnight' }], 'web', { now: new Date('2026-10-13T14:59:00Z') });
  assert.equal(store.appendEvents(user, [{ id: midnightId, kind: 'click', path: '/midnight' }], 'web', { now: new Date('2026-10-14T15:01:00Z') }).written, 0);
  assert.equal((await store.listEvents({ date: '2026-10-13', hour: 23, path: '/midnight' })).items.length, 1);
  assert.equal((await store.listEvents({ date: '2026-10-15', path: '/midnight' })).items.length, 0);
  // KST year boundary: the UTC dates are equal, but local audit days/years differ.
  const yearBoundaryId = randomUUID();
  store.appendEvents(user, [{ id: yearBoundaryId, kind: 'click', path: '/year-boundary' }], 'web', { now: new Date('2025-12-31T14:59:59Z') });
  store.appendEvents(user, [{ id: randomUUID(), kind: 'click', path: '/year-boundary' }], 'web', { now: new Date('2025-12-31T15:00:00Z') });
  assert.equal(store.appendEvents(user, [{ id: yearBoundaryId, kind: 'click', path: '/year-boundary' }], 'web', { now: new Date('2026-01-01T01:00:00Z') }).written, 0);
  const priorYear = (await store.listEvents({ date: '2025-12-31', hour: 23, path: '/year-boundary' })).items;
  const nextYear = (await store.listEvents({ date: '2026-01-01', hour: 0, path: '/year-boundary' })).items;
  assert.equal(priorYear.length, 1); assert.equal(priorYear[0].id, yearBoundaryId);
  assert.equal(nextYear.length, 1); assert.notEqual(nextYear[0].id, yearBoundaryId);
  assert.equal((await store.listEvents({ from: '2025-12-31', to: '2026-01-01', path: '/year-boundary' })).items.length, 2);
  const blocker = path.join(directory, 'blocked'); fs.writeFileSync(blocker, 'block');
  process.env.NENOVA_ACTIVITY_DIR = blocker;
  assert.throws(() => store.appendEvents(user, [{ ...event, id: randomUUID() }], 'web'));
  assert.equal(store.getHealth().healthy, false); assert.ok(store.getHealth().lastFailure.at);
  assert.ok(!JSON.stringify(store.getHealth()).includes(blocker));
  process.env.NENOVA_ACTIVITY_DIR = directory;
  store.appendEvents(user, [event], 'web'); assert.equal(store.getHealth().healthy, true);
  process.env.NENOVA_ACTIVITY_DIR = blocker;
  const failedResponse = new EventEmitter(); failedResponse.statusCode = 200;
  const oldError = console.error; console.error = () => {};
  try { attachRequestAudit({ url: '/api/retry-fixture', method: 'POST', headers: {} }, failedResponse, user); failedResponse.emit('finish'); } finally { console.error = oldError; }
  assert.equal(store.getHealth().pending, 1); assert.equal(store.getHealth().healthy, false);
  process.env.NENOVA_ACTIVITY_DIR = directory; retryPending();
  assert.equal(store.getHealth().pending, 0); assert.equal((await store.listEvents({ path: '/api/retry-fixture' })).items.length, 1);
  // API authentication/authorization and account-binding behavior, without loading Next.js or a real DB.
  const vm = require('node:vm');
  let source = fs.readFileSync(path.resolve(__dirname, '../pages/api/work/activity.js'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/export const config/, 'const config').replace('export async function activityHandler', 'async function activityHandler').replace('export default withAuth(activityHandler);', 'module.exports = activityHandler;');
  const sandbox = { module: { exports: {} }, store, console, isOrbitReportViewer: u => u.userId === 'nenovaSS3' };
  vm.runInNewContext(source, sandbox);
  const handler = sandbox.module.exports;
  const response = () => ({ setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
  Promise.resolve().then(async () => {
    let r = response(); await handler({ method: 'GET', query: {}, user: { userId: 'staff' } }, r); assert.equal(r.statusCode, 404);
    r = response(); await handler({ method: 'GET', query: { me: '1' }, user }, r); assert.equal(r.body.record, true); assert.equal(r.body.canView, true);
    r = response(); await handler({ method: 'POST', body: { expectedUserId: 'other', events: [event] }, user }, r); assert.equal(r.statusCode, 409);
    r = response(); await handler({ method: 'POST', body: { expectedUserId: user.userId, events: [event] }, user, headers: {} }, r); assert.equal(r.statusCode, 200); assert.deepEqual(r.body.acceptedIds, [id]);
    console.log('user activity server tests: PASS');
  }).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
} catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }

})().catch(error => { console.error(error); process.exitCode = 1; });
