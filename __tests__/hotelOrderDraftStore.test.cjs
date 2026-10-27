const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('../lib/hotelOrderDraftStore.cjs');
const work = (year = '2026') => ({ year, week: '44-01', request: [{ id: 'a', qty: 105 }], purchase: [], allocations: {}, pinned: [], raum: '680', surplus: '690', frozen: false, history: [], receipts: [], texts: { request: '미매칭 텍스트', purchase: '' } });
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hotel-drafts-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return { root }; }
test('server restart roundtrip includes raw text, classification and before/after results; owner and year isolated', async t => {
  const opts = await fixture(t), id = randomUUID(), w = work(); w.allocations = { 3: { 691: 15 } };
  await store.save('owner-a', { id, work: w, expectedRevision: 0 }, opts);
  delete require.cache[require.resolve('../lib/hotelOrderDraftStore.cjs')];
  const restarted = require('../lib/hotelOrderDraftStore.cjs');
  assert.deepEqual((await restarted.read('owner-a', '2026', '44-01', id, opts)).work, w);
  assert.equal((await store.list('owner-a', '2025', '44-01', opts)).length, 0);
  assert.equal((await store.list('owner-b', '2026', '44-01', opts)).length, 0);
  await assert.rejects(store.read('owner-b', '2026', '44-01', id, opts), { statusCode: 404 });
  await store.save('owner-a', { id, work: work('2025'), expectedRevision: 0 }, opts);
  assert.equal((await store.read('owner-a', '2026', '44-01', id, opts)).revision, 1);
});
test('two PCs race: exactly one revision wins and stale writes cannot overwrite it', async t => {
  const opts = await fixture(t), id = randomUUID();
  const outcomes = await Promise.allSettled([1, 2].map(n => store.save('a', { id, work: { ...work(), texts: { request: String(n) } }, expectedRevision: 0 }, opts)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(r => r.status === 'rejected').reason.statusCode, 409);
  await assert.rejects(store.save('a', { id, work: work(), expectedRevision: 0 }, opts), { statusCode: 409 });
  assert.equal((await store.read('a', '2026', '44-01', id, opts)).revision, 1);
});
test('pending intent survives lost response; frozen data and completed receipts cannot be erased', async t => {
  const opts = await fixture(t), id = randomUUID();
  const pending = { custKey: 680, year: '2026', week: '44-01', items: [{ prodKey: 3, qty: 30, expectedCurrentQty: 5 }], time: '2026-10-27T00:00:00Z', status: '결과 확인 필요', results: [] };
  const frozen = { ...work(), frozen: true, receipts: [pending] };
  await store.save('a', { id, work: frozen, expectedRevision: 0 }, opts);
  assert.equal((await store.read('a', '2026', '44-01', id, opts)).work.receipts[0].status, '결과 확인 필요');
  await assert.rejects(store.save('a', { id, work: { ...frozen, frozen: false }, expectedRevision: 1 }, opts), { statusCode: 409 });
  await assert.rejects(store.save('a', { id, work: { ...frozen, receipts: [] }, expectedRevision: 1 }, opts), { statusCode: 409 });
  const done = { ...pending, status: '등록·검증 완료', results: [{ prodKey: 3, previousQty: 5, finalQty: 35 }] };
  await store.save('a', { id, work: { ...frozen, receipts: [done] }, expectedRevision: 1 }, opts);
  await assert.rejects(store.save('a', { id, work: frozen, expectedRevision: 2 }, opts), { statusCode: 409 });
  await store.save('a', { id, work: { ...frozen, receipts: [{ ...done, current: { 3: 35 } }] }, expectedRevision: 2 }, opts);
  assert.deepEqual((await store.read('a', '2026', '44-01', id, opts)).work.receipts[0].results, done.results);
});
test('invalid scope, traversal and omitted/zero/stale versions are rejected', async t => {
  const opts = await fixture(t), id = randomUUID();
  for (const bad of [{ year: '2019' }, { week: '54-01' }, { week: '../44' }, { week: '44-00' }]) await assert.rejects(store.save('a', { id, work: { ...work(), ...bad }, expectedRevision: 0 }, opts), { statusCode: 400 });
  await assert.rejects(store.save('a', { id: '../x', work: work(), expectedRevision: 0 }, opts), { statusCode: 400 });
  await assert.rejects(store.save('a', { id, work: work() }, opts), { statusCode: 400 });
  await assert.rejects(store.save('', { id, work: work(), expectedRevision: 0 }, opts), { statusCode: 401 });
});
test('actual API always takes owner from authenticated session, rejects methods and disables caching', async () => {
  const vm = require('node:vm'), source = require('node:fs').readFileSync('pages/api/sales/hotel-order-drafts.js', 'utf8');
  const swc = require('next/dist/build/swc');
  const code = swc.transformSync(source, { filename: 'draft-api.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }).code;
  const module = { exports: {} }, calls = [];
  const mock = { list: async (...args) => { calls.push(args); return []; }, save: async (...args) => { calls.push(args); return { revision: 1 }; } };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name.endsWith('/auth') ? { withAuth: fn => fn } : mock });
  const invoke = async (method, body = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
    await module.exports.default({ method, user: { userId: 'session-owner' }, query: { year: '2026', week: '44-01', owner: 'other' }, body }, res); return res;
  };
  assert.equal((await invoke('GET')).headers['Cache-Control'], 'private, no-store');
  await invoke('POST', { owner: 'other' });
  assert.deepEqual(calls.map(c => c[0]), ['session-owner', 'session-owner']);
  assert.equal((await invoke('DELETE')).code, 405);
  assert.equal(calls.length, 2);
});
