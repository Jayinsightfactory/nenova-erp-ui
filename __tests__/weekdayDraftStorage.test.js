const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import('../lib/weekdayDraftStorage.js');
const scope = '533|2026|41';
const plan = (extra = {}) => ({ id: 'grid-one', draftScope: scope, custKey: 533, prodKey: 77,
  year: 2026, orderWeek: '41-01', date: '2026-10-11', quantity: 20, unit: '송이', ...extra });
const split = (extra = {}) => ({ scopeKey: scope, custKey: 533, prodKey: 77, year: 2026, majorWeek: '41',
  orderWeek: '41-01', date: '2026-10-11', expectedTotal: 20, wilsonQuantity: 5, unit: '송이', expectedRevision: 0, ...extra });
function memory() {
  const records = new Map();
  return { records, getItem: key => records.has(key) ? records.get(key) : null, setItem: (key, value) => records.set(key, value) };
}

test('manual input save survives refresh; user and cross-year scope stay isolated', async () => {
  const h = await modulePromise, storage = memory();
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan()], [split()]);
  const priorScope = '533|2025|41', prior = plan({ id: 'prior', draftScope: priorScope, year: 2025, date: '2025-10-12' });
  h.saveWeekdayScopedInputs(storage, 'staff', priorScope, [prior], []);
  assert.equal(h.readWeekdayStoredInputs(storage, 'staff').plans.length, 2);
  assert.equal(h.readWeekdayStoredInputs(storage, 'another-user').plans.length, 0);
  assert.equal(h.readWeekdayStoredInputs(storage, 'staff').wilsonDrafts[0].wilsonQuantity, 5);
  const restored = h.mergeWeekdayStoredInputs({ plans: [], wilsonDrafts: [] }, h.readWeekdayStoredInputs(storage, 'staff'));
  assert.deepEqual(restored.plans, [plan(), prior]);
});

test('saving one scope never deletes another customer or year; empty current scope is explicit clear', async () => {
  const h = await modulePromise, storage = memory();
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan()], [split()]);
  const other = plan({ id: 'other', draftScope: '675|2026|41', custKey: 675 });
  h.saveWeekdayScopedInputs(storage, 'staff', other.draftScope, [other], []);
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [], []);
  assert.deepEqual(h.readWeekdayStoredInputs(storage, 'staff').plans, [other]);
});

test('stale tabs cannot overwrite the same scope; unrelated scope changes are preserved', async () => {
  const h = await modulePromise, storage = memory();
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan({ quantity: 100 })], []);
  const baseline = { plans: h.readWeekdayStoredInputs(storage, 'staff').plans, wilsonDrafts: [] };
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan({ quantity: 120 })], [], baseline);
  const before = storage.getItem(h.weekdayInputStorageKey('staff'));
  const staleInput = [plan({ quantity: 100 })];
  assert.throws(() => h.saveWeekdayScopedInputs(storage, 'staff', scope, staleInput, [], baseline), /다른 창/);
  assert.equal(storage.getItem(h.weekdayInputStorageKey('staff')), before);
  assert.equal(staleInput[0].quantity, 100, 'caller input stays intact after conflict');
  const current = { plans: h.readWeekdayStoredInputs(storage, 'staff').plans, wilsonDrafts: [] };
  const other = plan({ id: 'other', draftScope: '675|2026|41', custKey: 675 });
  h.saveWeekdayScopedInputs(storage, 'staff', other.draftScope, [other], []);
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan({ quantity: 130 })], [], current);
  assert.deepEqual(h.readWeekdayStoredInputs(storage, 'staff').plans, [other, plan({ quantity: 130 })]);
});

test('invalid key/unit/date/quantity or ERP snapshot cannot be stored as apply authority', async () => {
  const h = await modulePromise;
  for (const extra of [{ unit: 'unknown' }, { date: '2026-02-30' }, { year: 2024 }, { custKey: 675 },
    { quantity: '' }, { quantity: null }, { quantity: -1 }, { orderWeek: '41' }, { expected: { snapshotDigest: 'x' } }]) {
    assert.throws(() => h.saveWeekdayScopedInputs(memory(), 'staff', scope, [plan(extra)], []));
  }
  assert.throws(() => h.saveWeekdayScopedInputs(memory(), 'staff', scope, [plan()], [split({ expectedTotal: 21 })]));
  assert.throws(() => h.saveWeekdayScopedInputs(memory(), 'staff', scope, [plan()], [split({ wilsonQuantity: 21 })]));
  h.saveWeekdayScopedInputs(memory(), 'staff', scope, [plan({ quantity: 0 })], [split({ expectedTotal: 0, wilsonQuantity: 0 })]);
  const originalDecimal = plan({ quantity: '1.1234567', orderWeek: '41-03' });
  const preserved = memory();
  h.saveWeekdayScopedInputs(preserved, 'staff', scope, [originalDecimal], []);
  assert.deepEqual(h.readWeekdayStoredInputs(preserved, 'staff').plans, [originalDecimal], 'input precision and actual full business week are preserved');
});

test('corrupt storage and quota errors preserve existing bytes and caller input', async () => {
  const h = await modulePromise, storage = memory(), key = h.weekdayInputStorageKey('staff');
  storage.setItem(key, '{broken');
  assert.throws(() => h.readWeekdayStoredInputs(storage, 'staff'));
  assert.throws(() => h.saveWeekdayScopedInputs(storage, 'staff', scope, [plan()], []));
  assert.equal(storage.getItem(key), '{broken');
  const good = memory(); h.saveWeekdayScopedInputs(good, 'staff', scope, [plan()], []);
  const before = good.getItem(key), edited = plan({ quantity: 30 }), original = JSON.stringify(edited);
  good.setItem = () => { throw Error('quota'); };
  assert.throws(() => h.saveWeekdayScopedInputs(good, 'staff', scope, [edited], []));
  assert.equal(good.getItem(key), before); assert.equal(JSON.stringify(edited), original);
});

test('pending UUID drafts override saved same id/scope and same Wilson key', async () => {
  const h = await modulePromise;
  const saved = { userId: 'staff', plans: [plan()], wilsonDrafts: [split()] };
  const pending = { inputUser: 'staff', payload: { operationId: 'authoritative' }, scopeKey: scope,
    drafts: [plan({ quantity: 30 })], wilson: [split({ expectedTotal: 30, wilsonQuantity: 8 })] };
  const merged = h.mergeWeekdayStoredInputs({ plans: [plan({ quantity: 25 })], wilsonDrafts: [] }, saved, pending);
  assert.equal(merged.plans.length, 1); assert.equal(merged.plans[0].quantity, 30);
  assert.equal(merged.wilsonDrafts[0].expectedTotal, 30);
  const raw = JSON.stringify(pending);
  assert.throws(() => h.mergeWeekdayStoredInputs({ plans: [], wilsonDrafts: [] }, { ...saved, userId: 'another-user' }, pending));
  assert.throws(() => h.mergeWeekdayStoredInputs({ plans: [], wilsonDrafts: [] }, saved, { ...pending, inputUser: undefined }));
  assert.equal(JSON.stringify(pending), raw, 'mismatched/legacy recovery bytes are not mutated');
});

test('ERP success clears exact stored submitted inputs; edits and other scopes survive', async () => {
  const h = await modulePromise, storage = memory();
  const one = plan(), edited = plan({ id: 'edited', prodKey: 78, quantity: 30 });
  h.saveWeekdayScopedInputs(storage, 'staff', scope, [one, edited], [split()]);
  h.clearWeekdayStoredSubmission(storage, 'staff', { submitted: [JSON.stringify(one), JSON.stringify({ ...edited, quantity: 20 })] });
  const reloaded = h.readWeekdayStoredInputs(storage, 'staff');
  assert.deepEqual(reloaded.plans, [edited]); assert.deepEqual(reloaded.wilsonDrafts, []);
});

test('workspace blur is draft-only, upload preserves inputs, and explicit save never calls ERP', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/WeekdayEstimateWorkspace.js'), 'utf8');
  assert.ok(source.includes('입력만 저장'));
  assert.ok(!source.includes('classificationOnly || Number(day.current)===total'));
  assert.ok(!source.includes('setFileName(file.name); setPlans([])'));
  const save = source.slice(source.indexOf('async function saveInputOnly()'), source.indexOf('useEffect(()=>{', source.indexOf('async function saveInputOnly()')));
  assert.ok(save.includes('saveWeekdayScopedInputs')); assert.ok(!save.includes('apiPost('));
  assert.ok(source.includes('clearWeekdayStoredSubmission(localStorage'));
  assert.ok(source.includes('compareRows:freshCompareRows.current'));
  assert.ok(source.includes('submission.inputUser = inputUser'));
  assert.ok(source.includes('if (!inputUser) return;'));
});
