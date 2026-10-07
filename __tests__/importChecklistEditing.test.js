import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as helpers from '../lib/importTeamChecklist.js';
import * as korean from '../lib/importTeamKorean.js';
import { readImportTeamRecord, writeImportTeamRecord, validateImportTeamKey, validateImportTeamValue } from '../lib/importTeamStore.js';

const actor = { userId: 'staff-a', userName: '인증 직원 A' };
const other = { userId: 'staff-b', userName: '인증 직원 B' };
const clone = value => JSON.parse(JSON.stringify(value));
const legacyEntries = JSON.parse(readFileSync(new URL('fixtures/importChecklistLegacyEntries.json', import.meta.url), 'utf8'));
const newTask = (patch = {}) => ({ id: `task::${randomUUID()}`, country: 'General', text: '반복 업무', ...patch });
async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-checklist-editing-'));
  try { return await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('weekday template CRUD keeps original IDs, deleted gaps, canonical 113 fixture and recurring scope', () => {
  const before = clone(helpers.TASKS);
  for (const day of helpers.DAYS) {
    const template = helpers.defaultWeekdayTemplate(day.id);
    assert.equal(validateImportTeamKey(helpers.checklistTemplateKey(day.id)), `checklist.templates.${day.id}`);
    assert.doesNotThrow(() => validateImportTeamValue(helpers.checklistTemplateKey(day.id), template));
    const second = template.tasks[1];
    template.tasks.splice(0, 1);
    second.text = '수정된 반복 업무';
    second.country = '새 분류';
    template.tasks.push(newTask());
    const date = helpers.weekDates('2026-10-06').find(row => row.id === day.id).date;
    const nextWeek = new Date(Date.parse(date) + 7 * 86400000).toISOString().slice(0, 10);
    assert.deepEqual(helpers.dailyTasks(date, template), helpers.dailyTasks(nextWeek, template));
    assert.equal(helpers.dailyTasks(date, template).flatMap(group => group.tasks)[0].key, second.id);
    assert.equal(helpers.checklistProgress(date, { [second.id]: true }, template).done, 1);
  }
  assert.deepEqual(helpers.TASKS, before);
  assert.equal(Object.values(helpers.TASKS).flatMap(Object.values).flat().length, 113);
});

test('template schema rejects null, invalid weekday, extra fields, duplicate/unstable IDs and malformed text', () => {
  const key = helpers.checklistTemplateKey('martes');
  const task = newTask();
  for (const value of [null, [], {}, { tasks: 'x' }, { tasks: [], taskActors: {} },
    { tasks: [task, task] }, { tasks: [newTask({ id: 'General::999' })] },
    { tasks: [newTask({ id: '__proto__' })] }, { tasks: [newTask({ text: '' })] },
    { tasks: [newTask({ text: ' padded ' })] }, { tasks: [newTask({ text: 'x'.repeat(1001) })] },
    { tasks: [newTask({ country: 'x'.repeat(81) })] }, { tasks: [newTask({ country: 3 })] },
    { tasks: [newTask({ text: 'x\u0000y' })] }, { tasks: [{ ...task, actor }] },
    { tasks: Array.from({ length: 501 }, () => newTask()) }]) {
    assert.throws(() => validateImportTeamValue(key, value), error => error.statusCode === 400);
  }
  assert.throws(() => validateImportTeamKey('checklist.templates.monday'));
  assert.throws(() => helpers.checklistTemplateKey('monday'));
  assert.doesNotThrow(() => validateImportTeamValue(key, { tasks: [] }));
});

test('template CAS rejects a stale edit/delete and does not alter daily checks or actors', () => withRoot(async root => {
  const key = helpers.checklistTemplateKey('martes');
  const initial = helpers.defaultWeekdayTemplate('martes');
  await writeImportTeamRecord(key, { value: initial, expectedRevision: 0, actor }, { root });
  const dailyKey = helpers.checklistDayKey('2026-10-06');
  const checks = await writeImportTeamRecord(dailyKey, { value: { 'Netherlands::0': true }, expectedRevision: 0, actor }, { root });
  const changed = clone(initial);
  changed.tasks[0].text = '팀원이 수정한 업무';
  await writeImportTeamRecord(key, { value: changed, expectedRevision: 1, actor: other }, { root });
  await assert.rejects(writeImportTeamRecord(key, { value: { tasks: initial.tasks.slice(1) }, expectedRevision: 1, actor }, { root }), error => error.statusCode === 409);
  assert.deepEqual((await readImportTeamRecord(key, { root })).value, changed);
  const after = await readImportTeamRecord(dailyKey, { root });
  assert.deepEqual(after.value, checks.value);
  assert.deepEqual(after.taskActors, checks.taskActors);
  assert.equal(after.revision, checks.revision);
  await writeImportTeamRecord(key, { value: { tasks: [] }, expectedRevision: 2, actor }, { root });
  assert.deepEqual((await readImportTeamRecord(key, { root })).value, { tasks: [] });
}));

test('day/month metadata is atomic, server-authored, unchanged checks survive and uncheck/recheck replaces attribution', () => withRoot(async root => {
  for (const key of [helpers.checklistDayKey('2026-10-06'), helpers.checklistMonthKey('2026-10')]) {
    const first = await writeImportTeamRecord(key, { value: { a: true, b: false }, expectedRevision: 0, actor, taskActors: { a: other } }, { root });
    assert.deepEqual(first.value, { a: true, b: false });
    assert.equal(first.taskActors.a.userId, actor.userId);
    assert.equal(first.taskActors.a.at, first.history[0].at);
    assert.equal(first.taskActors.a.checked, true);
    assert.deepEqual((await readImportTeamRecord(key, { root })).taskActors, first.taskActors);
    const noop = await writeImportTeamRecord(key, { value: first.value, expectedRevision: 1, actor: other }, { root });
    assert.equal(noop.revision, 1);
    assert.deepEqual(noop.taskActors, first.taskActors);
    const second = await writeImportTeamRecord(key, { value: { a: true, b: true }, expectedRevision: 1, actor: other }, { root });
    assert.deepEqual(second.taskActors.a, first.taskActors.a);
    assert.equal(second.taskActors.b.userId, other.userId);
    const unchecked = await writeImportTeamRecord(key, { value: { a: false, b: true }, expectedRevision: 2, actor: other }, { root });
    assert.equal(unchecked.taskActors.a.checked, false);
    assert.equal(unchecked.taskActors.a.userId, other.userId);
    const rechecked = await writeImportTeamRecord(key, { value: { a: true, b: true }, expectedRevision: 3, actor }, { root });
    assert.equal(rechecked.taskActors.a.checked, true);
    assert.equal(rechecked.taskActors.a.userId, actor.userId);
    assert.equal(rechecked.taskActors.a.at, rechecked.history.at(-1).at);
    assert.deepEqual(rechecked.taskActors.b, second.taskActors.b);
    await assert.rejects(writeImportTeamRecord(key, { value: { a: false }, expectedRevision: 2, actor: other }, { root }), error => error.statusCode === 409);
    assert.deepEqual((await readImportTeamRecord(key, { root })).taskActors, rechecked.taskActors);
    await assert.rejects(writeImportTeamRecord(key, { value: { a: true, taskActors: { a: other } }, expectedRevision: 4, actor }, { root }), error => error.statusCode === 400);
    const reset = await writeImportTeamRecord(key, { value: {}, expectedRevision: 4, actor }, { root });
    assert.deepEqual(reset.taskActors, {});
  }
}));

test('legacy checked records stay unknown even when another task changes; no history-based invented actor', () => withRoot(async root => {
  const key = helpers.checklistDayKey('2026-10-06');
  const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  await fs.writeFile(filename, JSON.stringify({ key, value: { a: true }, revision: 1, history: [{ revision: 1, at: '2026-10-06T01:00:00Z', ...other }] }));
  const saved = await writeImportTeamRecord(key, { value: { a: true, b: true }, expectedRevision: 1, actor }, { root });
  assert.equal(saved.taskActors.a, undefined);
  assert.match(helpers.checkedActorLabel(true, saved.taskActors.a), /알 수 없음/);
  assert.match(helpers.checkedActorLabel(true, saved.taskActors.b), /인증 직원 A.*staff-a.*KST/);
  assert.equal(helpers.checkedActorLabel(false, saved.taskActors.b), '');
  await assert.rejects(writeImportTeamRecord(key, { value: {}, expectedRevision: 2 }, { root }), error => error.statusCode === 401);
}));

test('reviewed draft merges only local changed keys including false, preserving concurrent checks and hidden deleted IDs', () => {
  const draft = { revision: 1, base: { a: true, hidden: true }, value: { a: false, hidden: true, local: true } };
  const latest = { a: true, hidden: false, team: true };
  const rebased = helpers.rebaseChecklistDraft(draft, latest, 3);
  assert.deepEqual(rebased.value, { a: false, hidden: false, team: true, local: true });
  assert.deepEqual(rebased.base, latest);
  assert.equal(rebased.revision, 3);
  assert.equal(draft.value.hidden, true, 'original draft is not mutated');
});

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const uiSource = readFileSync(new URL('../components/import-tools/ChecklistTool.js', import.meta.url), 'utf8');
const compiled = babel.transformSync(uiSource + '\nexport { ChecksPanel, WeekdayTemplatePanel, WeekdayChecklist, NotesPanel };', {
  filename: 'ChecklistTool.js', babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code;
function harness(name, props, initial = {}) {
  const slots = [], calls = [], confirmations = [], effects = [];
  const records = new Map();
  let cursor = 0, confirm = true, saveImpl = async () => {};
  const record = { value: initial, taskActors: {}, revision: 1, history: [], loading: false, saving: false, error: '', reload: async () => {} };
  record.save = async value => { calls.push(value); await saveImpl(value); record.value = value; record.revision += 1; };
  const hooks = { ...React,
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
    useEffect(effect) { effects.push(effect); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, crypto: { randomUUID }, Date, Math,
    window: { confirm(message) { confirmations.push(message); return confirm; } },
    require(name) {
      if (name === 'react') return hooks;
      if (name.endsWith('importTeamChecklist')) return helpers;
      if (name.endsWith('importTeamKorean')) return korean;
      if (name.endsWith('importTeamClient')) return { useImportTeamRecord: (key, initialValue) => {
        if (key.startsWith('checklist.settings.')) {
          if (!records.has(key)) {
            const settings = { value: null, taskActors: {}, revision: 0, history: [], loading: false, saving: false, error: '', reload: async () => {} };
            settings.save = async value => { settings.value = value; settings.revision += 1; };
            records.set(key, settings);
          }
          const settings = records.get(key);
          return { ...settings, value: settings.value ?? initialValue };
        }
        records.set(key, record);
        return { ...record, value: record.value ?? initialValue };
      } };
      throw Error(name);
    },
  });
  let localError = null;
  const managed = { ...record, busy: false, notice: '', fail(error) { localError = error; },
    async run(value, success) { if (managed.busy) return false; managed.busy = true; localError = null; try { await record.save(value); success?.(); return true; } catch (error) { localError = error; return false; } finally { managed.busy = false; } },
  };
  return { record, records, calls, confirmations, managed,
    setSave(impl) { saveImpl = impl; }, setConfirm(value) { confirm = value; },
    render() { cursor = 0; Object.assign(managed, record, { error: localError }); const tree = module.exports[name]({ ...props, ...(name === 'WeekdayTemplatePanel' ? { record: managed } : {}) }); effects.splice(0).forEach(effect => effect()); return tree; },
    html() { return renderToStaticMarkup(this.render()); },
  };
}
function nodes(element) { return React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(nodes)] : []; }
function find(tree, predicate) { const result = nodes(tree).find(predicate); assert.ok(result, 'UI control exists'); return result; }
const button = (h, text) => find(h.render(), node => node.type === 'button' && String(node.props.children).includes(text));
function field(h, label, value) {
  const parent = find(h.render(), node => node.type === 'label' && React.Children.toArray(node.props.children)[0] === label);
  find(parent, node => ['input', 'textarea'].includes(node.type)).props.onChange({ target: { value } });
}
const submit = h => find(h.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Korean template UI CRUD retains IDs, validates, confirms delete, keeps failed drafts and requires stale review', async () => {
  const h = harness('WeekdayTemplatePanel', { weekday: helpers.DAYS[1] }, helpers.defaultWeekdayTemplate('martes'));
  const originalId = h.record.value.tasks[0].id;
  button(h, '반복 업무 수정').props.onClick();
  field(h, '반복 업무 내용', '수정 초안');
  h.setSave(async () => { throw Object.assign(new Error('버전 충돌'), { status: 409 }); });
  await submit(h);
  assert.match(h.html(), /수정 초안/);
  assert.equal(h.record.value.tasks[0].id, originalId);
  assert.notEqual(h.record.value.tasks[0].text, '수정 초안');
  h.record.value = clone(h.record.value);
  h.record.value.tasks.push(newTask({ text: '다른 팀원 추가' }));
  h.record.revision += 1;
  assert.equal(button(h, '반복 업무 수정 · 공동 저장').props.disabled, true);
  await submit(h);
  assert.equal(h.calls.length, 1);
  button(h, '목록 비교 완료').props.onClick();
  h.setSave(async () => {});
  await submit(h);
  assert.equal(h.record.value.tasks[0].id, originalId);
  assert.equal(h.record.value.tasks[0].text, '수정 초안');
  assert.equal(h.record.value.tasks.at(-1).text, '다른 팀원 추가');
  field(h, '국가·분류', '새 분류');
  field(h, '반복 업무 내용', '추가한 업무');
  await submit(h);
  assert.match(h.record.value.tasks.at(-1).id, /^task::/);
  const addedId = h.record.value.tasks.at(-1).id;
  h.setConfirm(false);
  button(h, '반복 업무 삭제').props.onClick();
  assert.match(h.confirmations[0], /매주 화요일.*공동 목록/s);
  assert.equal(h.record.value.tasks[0].id, originalId);
  h.setConfirm(true);
  button(h, '반복 업무 삭제').props.onClick();
  await tick();
  assert.notEqual(h.record.value.tasks[0].id, originalId);
  assert.equal(h.record.value.tasks.at(-1).id, addedId);
  assert.match(h.html(), /날짜별 체크.*미저장 초안.*별도로 유지/);
});

test('template editor stale deleted target cannot be recreated and blank form is rejected', async () => {
  const h = harness('WeekdayTemplatePanel', { weekday: helpers.DAYS[1] }, helpers.defaultWeekdayTemplate('martes'));
  button(h, '반복 업무 수정').props.onClick();
  h.record.value = { tasks: h.record.value.tasks.slice(1) };
  h.record.revision += 1;
  button(h, '목록 비교 완료').props.onClick();
  await submit(h);
  assert.equal(h.calls.length, 0);
  assert.match(h.html(), /이 업무를 삭제/);
  button(h, '입력 초안 취소').props.onClick();
  field(h, '국가·분류', 'General');
  field(h, '반복 업무 내용', ' ');
  await submit(h);
  assert.equal(h.calls.length, 0);
});

test('manual checkbox save keeps actor pending until success, failure preserves draft and legacy actor is unknown', async () => {
  const h = harness('ChecksPanel', { date: '2026-10-06' }, { 'Netherlands::1': true });
  assert.match(h.html(), /알 수 없음/);
  const check = () => find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox');
  check().props.onChange({ target: { checked: true } });
  assert.match(h.html(), /체크 변경 미저장/);
  assert.doesNotMatch(h.html(), /인증 직원 A/);
  let finish;
  h.setSave(() => new Promise(resolve => { finish = () => { h.record.taskActors = { 'Netherlands::0': { ...actor, at: '2026-10-06T01:02:03Z', checked: true } }; resolve(); }; }));
  const saved = button(h, '초안 공동 저장').props.onClick();
  assert.match(h.html(), /미저장/);
  assert.doesNotMatch(h.html(), /인증 직원 A/);
  finish(); await saved;
  assert.match(h.html(), /인증 직원 A.*staff-a.*KST/);
  assert.doesNotMatch(h.html(), /체크 변경 미저장/);
  check().props.onChange({ target: { checked: false } });
  assert.match(h.html(), /체크 변경 미저장/);
  h.setSave(async () => { throw new Error('offline'); });
  await button(h, '초안 공동 저장').props.onClick();
  assert.equal(check().props.checked, false);
  assert.equal(h.record.value['Netherlands::0'], true);
  assert.match(h.html(), /인증 직원 A/);
});

test('one template scope serves every visited same-weekday date without replacing daily draft instances', () => {
  const h = harness('WeekdayChecklist', { weekday: helpers.DAYS[1], dates: ['2026-10-06', '2026-10-13'], date: '2026-10-13' }, helpers.defaultWeekdayTemplate('martes'));
  const panels = nodes(h.render()).filter(node => typeof node.type === 'function' && node.type.name === 'ChecksPanel');
  assert.deepEqual(panels.map(node => node.props.date), ['2026-10-06', '2026-10-13']);
  assert.equal(panels[0].props.templateRecord, panels[1].props.templateRecord);
  const wrappers = nodes(h.render()).filter(node => node.type === 'div');
  assert.deepEqual(wrappers.map(node => node.props.hidden), [true, false]);
});

test('pending and flight fields use id::field server metadata, preserve unchanged actors on text edit, remove on delete', () => withRoot(async root => {
  for (const [key, fields] of [['checklist.pending', ['done']], ['checklist.flights', ['llegado', 'banib']]]) {
    const base = { id: 'entry-1', text: '업무' };
    fields.forEach(field => { base[field] = false; });
    const first = await writeImportTeamRecord(key, { value: [base], expectedRevision: 0, actor }, { root });
    const checked = { ...base, [fields[0]]: true };
    const second = await writeImportTeamRecord(key, { value: [checked], expectedRevision: 1, actor: other }, { root });
    assert.equal(second.taskActors[`entry-1::${fields[0]}`].userId, other.userId);
    for (const field of fields.slice(1)) assert.deepEqual(second.taskActors[`entry-1::${field}`], first.taskActors[`entry-1::${field}`]);
    const textEdit = await writeImportTeamRecord(key, { value: [{ ...checked, text: '내용만 수정' }], expectedRevision: 2, actor }, { root });
    assert.deepEqual(textEdit.taskActors, second.taskActors);
    const unchecked = await writeImportTeamRecord(key, { value: [{ ...checked, [fields[0]]: false }], expectedRevision: 3, actor }, { root });
    assert.equal(unchecked.taskActors[`entry-1::${fields[0]}`].checked, false);
    assert.equal(unchecked.taskActors[`entry-1::${fields[0]}`].userId, actor.userId);
    const rechecked = await writeImportTeamRecord(key, { value: [checked], expectedRevision: 4, actor: other }, { root });
    assert.equal(rechecked.taskActors[`entry-1::${fields[0]}`].checked, true);
    const deleted = await writeImportTeamRecord(key, { value: [], expectedRevision: 5, actor }, { root });
    assert.deepEqual(deleted.taskActors, {});
  }
}));

test('pending/flights require exact source fields and unique String(id), rejecting duplicates, type collisions and metadata injection', () => {
  for (const [key, rows] of [['checklist.pending', legacyEntries.pending], ['checklist.flights', legacyEntries.flights]]) {
    const base = clone(rows[0]);
    for (const value of [
      [base, { ...base }], [base, { ...base, id: String(base.id) }], [{ ...base, id: String(base.id) }, base],
      [null], [1], ['entry'], [{}], [[base]],
      ...[null, true, {}, [], '', ' padded ', 'id\n', 'id\r', 'id\t', 'x::done', '../entry', 'x/y', '__proto__', 'x'.repeat(129), 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(id => [{ ...base, id }]),
      ...['actor', 'taskActors', 'userId', 'userName', 'checkedAt', 'createdAt', 'note', 'revision'].map(field => [{ ...base, [field]: { userId: 'forged' } }]),
      [{ ...base, text: '' }], [{ ...base, text: 1 }],
      [{ ...base, [key === 'checklist.pending' ? 'done' : 'llegado']: 'true' }],
      [{ ...base, [key === 'checklist.pending' ? 'banib' : 'done']: false }],
    ]) assert.throws(() => validateImportTeamValue(key, value), error => error.statusCode === 400);
    const missing = { ...base };
    delete missing[key === 'checklist.pending' ? 'done' : 'banib'];
    assert.throws(() => validateImportTeamValue(key, [missing]), error => error.statusCode === 400);
    assert.doesNotThrow(() => validateImportTeamValue(key, rows));
    assert.doesNotThrow(() => validateImportTeamValue(key, []));
    assert.doesNotThrow(() => validateImportTeamValue(key, null));
  }
});

test('source-compatible numeric/fractional IDs and native string IDs roundtrip unchanged through normal CRUD and actor saves', () => withRoot(async root => {
  for (const [key, rows, field] of [['checklist.pending', legacyEntries.pending, 'done'], ['checklist.flights', legacyEntries.flights, 'llegado']]) {
    const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
    await fs.writeFile(filename, JSON.stringify({ key, value: rows, revision: 1, history: [] }));
    const read = await readImportTeamRecord(key, { root });
    assert.deepEqual(read.value, rows);
    assert.equal(read.taskActors, undefined);
    const noop = await writeImportTeamRecord(key, { value: clone(rows), expectedRevision: 1, actor }, { root });
    assert.equal(noop.revision, 1);
    assert.deepEqual(noop.value, rows);
    assert.equal(noop.taskActors, undefined, 'unchanged legacy checks have no invented actor');
    const textEdit = clone(rows);
    textEdit[0].text += '\n내용 수정';
    const edited = await writeImportTeamRecord(key, { value: textEdit, expectedRevision: 1, actor }, { root });
    assert.deepEqual(edited.value, textEdit);
    assert.deepEqual(edited.taskActors, {});
    const checked = clone(textEdit);
    checked[0][field] = !checked[0][field];
    const saved = await writeImportTeamRecord(key, { value: checked, expectedRevision: 2, actor: other }, { root });
    assert.deepEqual(saved.value.map(row => row.id), rows.map(row => row.id));
    assert.equal(saved.taskActors[`${rows[0].id}::${field}`].userId, other.userId);
    const added = [...checked, { ...rows[0], id: randomUUID(), text: '새 항목' }];
    await writeImportTeamRecord(key, { value: added, expectedRevision: 3, actor }, { root });
    const deleted = added.filter(row => row.id !== rows[0].id);
    const result = await writeImportTeamRecord(key, { value: deleted, expectedRevision: 4, actor }, { root });
    assert.deepEqual(result.value, deleted);
    assert.equal(result.taskActors[`${rows[0].id}::${field}`], undefined);
  }
}));

test('rejected duplicate/type-collision/injected-actor saves leave persisted value, revision and actor metadata untouched', () => withRoot(async root => {
  for (const [key, rows] of [['checklist.pending', legacyEntries.pending], ['checklist.flights', legacyEntries.flights]]) {
    const valid = [clone(rows[0])];
    const saved = await writeImportTeamRecord(key, { value: valid, expectedRevision: 0, actor }, { root });
    const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
    const bytes = await fs.readFile(filename, 'utf8');
    for (const invalid of [[...valid, { ...valid[0] }], [...valid, { ...valid[0], id: String(valid[0].id) }],
      [{ ...valid[0], actor: other }], [{ ...valid[0], taskActors: { [`${valid[0].id}::done`]: other } }]]) {
      await assert.rejects(writeImportTeamRecord(key, { value: invalid, expectedRevision: 1, actor: other }, { root }), error => error.statusCode === 400);
      assert.equal(await fs.readFile(filename, 'utf8'), bytes);
      const result = await readImportTeamRecord(key, { root });
      assert.deepEqual(result.value, saved.value);
      assert.deepEqual(result.taskActors, saved.taskActors);
      assert.equal(result.revision, saved.revision);
    }
  }
}));

test('ambiguous or injected persisted pending/flights records fail closed, never normalize or overwrite', () => withRoot(async root => {
  for (const [key, rows] of [['checklist.pending', legacyEntries.pending], ['checklist.flights', legacyEntries.flights]]) {
    const base = clone(rows[0]);
    const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
    for (const invalid of [[base, { ...base, id: String(base.id) }], [{ ...base, actor: other }]]) {
      const bytes = JSON.stringify({ key, value: invalid, revision: 1, history: [] });
      await fs.writeFile(filename, bytes);
      await assert.rejects(readImportTeamRecord(key, { root }), error => error.statusCode === 500);
      await assert.rejects(writeImportTeamRecord(key, { value: [base], expectedRevision: 1, actor }, { root }), error => error.statusCode === 500);
      assert.equal(await fs.readFile(filename, 'utf8'), bytes);
    }
  }
}));

test('pending/flights actor UI ignores entry actor, displays unknown legacy and only adopts saved server attribution', async () => {
  for (const flights of [false, true]) {
    const field = flights ? 'llegado' : 'done';
    const h = harness('NotesPanel', { flights }, [{ id: 'entry-1', text: '업무', [field]: true, banib: false, actor: { userId: 'forged', userName: '위조' } }]);
    assert.match(h.html(), /알 수 없음/);
    assert.doesNotMatch(h.html(), /위조|forged/);
    h.record.taskActors[`entry-1::${field}`] = { ...actor, at: '2026-10-06T01:00:00Z', checked: true };
    assert.match(h.html(), /인증 직원 A/);
    const check = () => find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox');
    check().props.onChange({ target: { checked: false } });
    await tick();
    assert.equal(h.record.value[0][field], false);
    let finish;
    h.setSave(() => new Promise(resolve => { finish = () => { h.record.taskActors[`entry-1::${field}`] = { ...other, at: '2026-10-06T02:00:00Z', checked: true }; resolve(); }; }));
    const saved = check().props.onChange({ target: { checked: true } });
    assert.equal(check().props.checked, false);
    assert.match(h.html(), /체크 변경 저장 중/);
    assert.doesNotMatch(h.html(), /인증 직원 B/);
    finish(); await saved;
    assert.equal(check().props.checked, true);
    assert.match(h.html(), /인증 직원 B.*staff-b/);
    assert.doesNotMatch(h.html(), /체크 변경 저장 중/);
  }
});

test('actual client hook keeps GET/PUT actor metadata separate from boolean values and never sends it back', async () => {
  const source = readFileSync(new URL('../lib/importTeamClient.js', import.meta.url), 'utf8');
  const compiledClient = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')] }).code;
  const slots = [], pending = [], effects = [];
  let cursor = 0, key = 'checklist.day.2026-10-06';
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useCallback(callback) { return callback; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiledClient, { module, exports: module.exports, require: () => hooks,
    fetch(url, options) { return new Promise(resolve => pending.push({ url, body: options.body ? JSON.parse(options.body) : null,
      finish(value, revision, taskActors, status = 200) { resolve({ ok: status === 200, status, json: async () => ({ success: status === 200, value, revision, taskActors, error: '충돌' }) }); },
    })); },
  });
  const render = () => { cursor = 0; return module.exports.useImportTeamRecord(key, {}); };
  render(); effects.splice(0).forEach(effect => effect());
  const metadata = { a: { ...actor, checked: true, at: '2026-10-06T01:00:00Z' } };
  pending[0].finish({ a: true }, 1, metadata); await tick();
  let result = render();
  assert.deepEqual(result.value, { a: true });
  assert.deepEqual(result.taskActors, metadata);
  const save = result.save({ a: true, b: true });
  assert.deepEqual(pending[1].body, { expectedRevision: 1, value: { a: true, b: true } });
  assert.deepEqual(render().taskActors, metadata, 'in-flight save cannot invent new actors');
  const savedMetadata = { ...metadata, b: { ...other, checked: true, at: '2026-10-06T02:00:00Z' } };
  pending[1].finish({ a: true, b: true }, 2, savedMetadata); await save;
  assert.deepEqual(render().taskActors, savedMetadata);
  result = render();
  const stale = result.save({ a: false });
  const rejection = assert.rejects(stale, error => error.status === 409);
  pending[2].finish(null, 0, undefined, 409); await rejection;
  assert.deepEqual(render().taskActors, savedMetadata);
  key = 'checklist.month.2026-10';
  assert.deepEqual(JSON.parse(JSON.stringify(render().taskActors)), {}, 'metadata never leaks across scopes');
  effects.splice(0).forEach(effect => effect());
  pending[3].finish({ day1_0: true }, 1, undefined); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(render().taskActors)), {}, 'legacy GET has no invented metadata');
});

test('invalid persisted template fails closed without overwriting its data', () => withRoot(async root => {
  const key = helpers.checklistTemplateKey('martes');
  const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  const corrupt = JSON.stringify({ key, value: { tasks: [{ id: 'General::999', country: 'General', text: '잘못된 ID' }] }, revision: 1, history: [] });
  await fs.writeFile(filename, corrupt);
  await assert.rejects(readImportTeamRecord(key, { root }), error => error.statusCode === 500);
  await assert.rejects(writeImportTeamRecord(key, { value: helpers.defaultWeekdayTemplate('martes'), expectedRevision: 1, actor }, { root }), error => error.statusCode === 500);
  assert.equal(await fs.readFile(filename, 'utf8'), corrupt);
}));

test('browser layout smoke: 1920x1080 at 100% and mobile 390x844, no horizontal clipping and editor scroll controls accessible', {
  skip: !process.env.CHROME_BIN ? 'Optional browser smoke: set CHROME_BIN to an installed Chromium executable.' : false,
}, async () => {
  const executablePath = process.env.CHROME_BIN;
  assert.ok(existsSync(executablePath), 'CHROME_BIN must point to an installed Chromium executable.');
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    const template = helpers.defaultWeekdayTemplate('lunes');
    template.tasks.push(newTask({ country: '긴 분류'.repeat(15), text: '긴업무내용'.repeat(100) }));
    const record = { value: template, revision: 1, busy: false, loading: false, error: '', notice: '', reload() {}, run() {}, fail() {} };
    const checks = harness('ChecksPanel', { date: '2026-10-05', templateRecord: record }, { 'Netherlands::0': true });
    const root = harness('default', {}, null).render();
    const style = find(root, node => node.type === 'style').props.children;
    const html = `<style>html,body{margin:0;width:100%;}main{box-sizing:border-box;padding:16px;max-width:100%;}</style><main class="import-checklist"><style>${style}</style>${checks.html()}</main>`;
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      await page.setContent(html);
      await page.$eval('details', node => { node.open = true; });
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale,
        overflow: document.documentElement.scrollWidth > innerWidth,
        escaped: [...document.querySelectorAll('input,textarea,button,summary')].some(node => { const box = node.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; }),
        scrollable: [...document.querySelectorAll('.record-list')].some(node => node.scrollHeight > node.clientHeight),
      }));
      assert.deepEqual([metrics.width, metrics.height, metrics.scale], [viewport.width, viewport.height, 1]);
      assert.equal(metrics.overflow, false, JSON.stringify(metrics));
      assert.equal(metrics.escaped, false, JSON.stringify(metrics));
      assert.equal(metrics.scrollable, true, 'long template list remains scrollable');
      const submit = await page.$('details button[type=submit]');
      await submit.scrollIntoView();
      assert.equal(await submit.isVisible(), true);
    }
  } finally { await browser.close(); }
});
