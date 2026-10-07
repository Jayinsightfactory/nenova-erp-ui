import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as helpers from '../lib/importTeamChecklist.js';
import * as korean from '../lib/importTeamKorean.js';
import { validateImportTeamKey, validateImportTeamValue, readImportTeamRecord, writeImportTeamRecord, listImportTeamHistory } from '../lib/importTeamStore.js';

const actor = { userId: 'settings-staff', userName: '설정 담당자' };
test('planting quantities/prices cannot overflow multi-row summaries',()=>{
 const row={id:'bounded',variety:'Polimnia',farm:'농장',boxes:1e9,price:1e9,note:'',createdAt:1};
 assert.doesNotThrow(()=>helpers.validatePlantingEntries([row]));
 for(const field of ['boxes','price']){
  assert.throws(()=>helpers.validatePlantingEntries([{...row,[field]:Number.MAX_VALUE}]));
  assert.throws(()=>helpers.validatePlanting({...row,[field]:Number.MAX_VALUE}));
 }
 const rows=Array.from({length:10000},(_,i)=>({...row,id:String(i)}));
 assert(Number.isFinite(helpers.plantingSummary(rows)[0].assigned));
 assert(Number.isFinite(helpers.groupPlanting(rows)[0].boxes));
});
const employeeKey = helpers.checklistEmployeeSettingsKey(2026);
const plantingKey = helpers.SHARED_KEYS.plantingSettings;
const vacationRow = (patch = {}) => ({ id: 'vacation-1', employee: 'Gabriel', start: '2026-10-07', end: '2026-10-07', days: 1, note: '', ...patch });
async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nenova-import-settings-'));
  try { return await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
const write = (root, key, value, expectedRevision = 0) => writeImportTeamRecord(key, { value, expectedRevision, actor }, { root });

test('settings keys are bounded: employees per year, planting global', () => {
  assert.equal(employeeKey, 'checklist.settings.employees.2026');
  assert.equal(plantingKey, 'checklist.settings.planting');
  for (const key of [employeeKey, helpers.checklistEmployeeSettingsKey(2025), plantingKey]) assert.equal(validateImportTeamKey(key), key);
  for (const year of ['', 26, '2026.5', '2026/path']) assert.throws(() => helpers.checklistEmployeeSettingsKey(year));
  for (const key of ['checklist.settings.employees', 'checklist.settings.employees.26', 'checklist.settings.planting.2026', 'checklist.settings.actor']) assert.throws(() => validateImportTeamKey(key));
});

test('identical strict client/server config validation: unique trimmed names, finite nonnegative numbers, exact shape', () => {
  for (const [key, validator, field] of [[employeeKey, helpers.validateEmployeeSettings, 'total'], [plantingKey, helpers.validatePlantingSettings, 'target']]) {
    for (const value of [[], [{ name: '새 이름', [field]: 0 }], [{ name: 'Fraction', [field]: 0.5 }]]) {
      assert.deepEqual(validator(value), value);
      assert.doesNotThrow(() => validateImportTeamValue(key, value));
    }
    const invalid = [null, {}, [{ name: ' Name ', [field]: 1 }], [{ name: '', [field]: 1 }], [{ name: 'a\nb', [field]: 1 }],
      [{ name: 'a'.repeat(81), [field]: 1 }], [{ name: 'A', [field]: 1 }, { name: 'A', [field]: 2 }],
      ...[-1, NaN, Infinity, -Infinity, '1', '', true, null].map(amount => [{ name: 'A', [field]: amount }]),
      [{ name: 'A' }], [{ name: 'A', [field]: 1, actor }], [{ name: 'A', [field]: 1, userId: 'spoof' }],
      Array.from({ length: 501 }, (_, i) => ({ name: `N${i}`, [field]: 1 }))];
    for (const value of invalid) {
      assert.throws(() => validator(value));
      assert.throws(() => validateImportTeamValue(key, value), error => error.statusCode === 400);
    }
  }
});

test('absent GETs never initialize/migrate runtime data; explicit [] and zero persist through reload', () => withRoot(async root => {
  const before = await fs.readdir(root);
  for (const key of [employeeKey, plantingKey]) {
    const absent = await readImportTeamRecord(key, { root });
    assert.equal(absent.value, null);
    assert.equal(absent.revision, 0);
  }
  assert.deepEqual(await fs.readdir(root), before);
  await write(root, employeeKey, []);
  await write(root, plantingKey, [{ name: 'Zero', target: 0 }]);
  assert.deepEqual((await readImportTeamRecord(employeeKey, { root })).value, []);
  assert.deepEqual((await readImportTeamRecord(plantingKey, { root })).value, [{ name: 'Zero', target: 0 }]);
  const snapshot = await fs.readdir(root);
  await readImportTeamRecord(employeeKey, { root });
  assert.deepEqual(await fs.readdir(root), snapshot);
}));

test('settings CAS CRUD isolates years and preserves vacation/planting values, history and authenticated actor', () => withRoot(async root => {
  const year2025 = helpers.checklistEmployeeSettingsKey(2025);
  const vacation = [{ id: 'v1', employee: 'Gabriel', start: '2026-10-07', end: '2026-10-07', days: 1, note: 'old' }];
  const planting = [{ id: 'p1', variety: 'Polimnia', farm: 'Farm', boxes: 10, price: 0, createdAt: 1, note: 'old' }];
  const oldVacation = await write(root, helpers.checklistVacationKey(2026), vacation);
  const oldPlanting = await write(root, helpers.SHARED_KEYS.planting, planting);
  await write(root, year2025, [{ name: 'Gabriel', total: 15 }]);
  await write(root, employeeKey, [{ name: 'Gabriel', total: 20, adjustmentReason: 'annual review' }]);
  await write(root, plantingKey, [{ name: 'Polimnia', target: 25 }]);
  await assert.rejects(write(root, employeeKey, [{ name: 'Gabriel', total: 99 }], 0), error => error.statusCode === 409);
  await write(root, employeeKey, [{ name: 'Gabriel', total: 0, adjustmentReason: 'balance review' }, { name: 'New', total: 5 }], 1);
  await write(root, plantingKey, [], 1);
  await write(root, employeeKey, [], 2);
  assert.deepEqual((await readImportTeamRecord(year2025, { root })).value, [{ name: 'Gabriel', total: 15 }]);
  for (const [key, saved] of [[helpers.checklistVacationKey(2026), oldVacation], [helpers.SHARED_KEYS.planting, oldPlanting]]) {
    const record = await readImportTeamRecord(key, { root });
    assert.deepEqual(record.value, saved.value);
    assert.deepEqual(record.history, saved.history);
    assert.equal(record.revision, saved.revision);
  }
  const config = await readImportTeamRecord(employeeKey, { root });
  assert.equal(config.revision, 3);
  assert.deepEqual(config.value, []);
  assert.equal(config.history.length, 3);
  assert(config.history.every(event => event.userId === actor.userId && event.userName === actor.userName));
  assert.equal((await listImportTeamHistory({ root })).length, 8);
  const first = await readImportTeamRecord(plantingKey, { root });
  await assert.rejects(write(root, plantingKey, [{ name: 'Bad', target: 2, userName: 'Spoof' }], 2), error => error.statusCode === 400);
  await assert.rejects(writeImportTeamRecord(plantingKey, { value: [], expectedRevision: 2 }, { root }), error => error.statusCode === 401);
  assert.deepEqual(await readImportTeamRecord(plantingKey, { root }), first);
}));

test('persisted malformed settings fail closed on GET without changing bytes', () => withRoot(async root => {
  await write(root, employeeKey, [{ name: 'Staff', total: 15 }]);
  const filename = path.join(root, createHash('sha256').update(employeeKey).digest('hex') + '.json');
  const saved = JSON.parse(await fs.readFile(filename, 'utf8'));
  saved.value[0].actor = 'spoof';
  const bytes = JSON.stringify(saved);
  await fs.writeFile(filename, bytes);
  await assert.rejects(readImportTeamRecord(employeeKey, { root }), error => error.statusCode === 500);
  assert.equal(await fs.readFile(filename, 'utf8'), bytes);
}));

test('optional helper configs retain original defaults, explicit empty lists and deleted historical references', () => {
  assert.equal(helpers.vacationSummary([]).length, helpers.EMPLOYEES.length);
  assert.equal(helpers.plantingSummary([]).length, helpers.PLANT_VARIETIES.length);
  assert.deepEqual(helpers.vacationSummary([], []), []);
  assert.deepEqual(helpers.plantingSummary([], []), []);
  const vacation = vacationRow({ employee: 'Former', days: 0.5 });
  const planting = { id: 'plant-1', createdAt: 1, variety: 'Former', farm: 'Farm', boxes: 1, price: 0, note: '' };
  assert.throws(() => helpers.validateVacation(vacation, 2026));
  assert.throws(() => helpers.validatePlanting(planting));
  const employees = helpers.checklistSettingsOptions([vacation], [], 'employee');
  const varieties = helpers.checklistSettingsOptions([planting], [], 'variety');
  assert.equal(helpers.validateVacation(vacation, 2026, employees).employee, 'Former');
  assert.equal(helpers.validatePlanting(planting, varieties).variety, 'Former');
  assert.equal(helpers.vacationSummary([vacation], [])[0].status, 'unconfigured');
  assert.equal(helpers.plantingSummary([planting], [])[0].status, 'unconfigured');
  assert.equal(helpers.vacationSummary([vacation], [{ name: 'Former', total: 0 }])[0].percent, 0);
  assert.equal(helpers.plantingSummary([], [{ name: 'Former', target: 0 }])[0].percent, 0);
  assert.equal(helpers.plantingSummary([planting], [{ name: 'Former', target: 0 }])[0].percent, 100);
  assert.deepEqual(helpers.groupPlanting([{ ...planting, variety: 'A' }, { ...planting, variety: 'B' }], 'variety', [{ name: 'B', target: 1 }, { name: 'A', target: 1 }]).map(group => group.name), ['B', 'A']);
});

// Run real component handlers with independent record keys and passive effects.
const require = createRequire(import.meta.url);
const React = require('react');
const babel = require('next/dist/compiled/babel/core');
const uiSource = readFileSync(new URL('../components/import-tools/ChecklistTool.js', import.meta.url), 'utf8');
const compiled = babel.transformSync(uiSource + '\nexport { SettingsPanel, RemainingVacationEditor, VacationAdjustmentHistory, VacationPanel, PlantingPanel, NotesPanel };', {
  filename: 'ChecklistTool.js', babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code;
function harness(component, props = {}, initial = {}) {
  let cursor = 0;
  const slots = [], records = new Map(), effects = [], calls = [], confirmations = [];
  const hooks = {
    ...React,
    useState(init) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(init) { const index = cursor++; if (!(index in slots)) slots[index] = { current: init }; return slots[index]; },
    useEffect(effect) { effects.push(effect); },
  };
  function record(key, fallback) {
    if (!records.has(key)) {
      const row = { key, value: Object.hasOwn(initial, key) ? initial[key] : fallback, revision: 0, loading: false, saving: false, error: '', taskActors: {}, reload: async () => {} };
      row.save = async value => { calls.push({ key, value }); await row.saveImpl?.(value); row.value = value; row.revision += 1; };
      records.set(key, row);
    }
    return records.get(key);
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, Math, crypto: { randomUUID: () => 'test-id' },
    window: { confirm: message => { confirmations.push(message); return true; } },
    require(name) {
      if (name === 'react') return hooks;
      if (name === '../../lib/importTeamChecklist') return helpers;
      if (name === '../../lib/importTeamKorean') return korean;
      if (name === '../../lib/importTeamClient') return { useImportTeamRecord: record };
      throw Error(name);
    },
  });
  return {
    calls, records, confirmations,
    render() { cursor = 0; const tree = module.exports[component](props); effects.splice(0).forEach(effect => effect()); return tree; },
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(row => nodes(row, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const button = (tree, label) => nodes(tree, row => row.type === 'button' && text(row) === label)[0];
const form = tree => nodes(tree, row => row.type === 'form')[0];
const input = (tree, label) => nodes(tree, row => row.type === 'label' && text(row).startsWith(label)).flatMap(row => nodes(row, child => child.type === 'input'))[0];
const change = (element, value) => element.props.onChange({ target: { value } });
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });

function settingsHarness(value = []) {
  const record = { value, revision: 1, busy: false, error: null, notice: '', reload: async () => {}, fail(error) { this.error = error; } };
  const calls = [];
  record.run = async (next, success) => {
    calls.push(next);
    try { await record.saveImpl?.(next); record.value = next; record.revision += 1; record.notice = '공동 저장 완료'; success?.(); return true; }
    catch (error) { record.error = error; return false; }
  };
  return { ...harness('SettingsPanel', { record, employees: true, year: 2026 }), record, saves: calls };
}

test('settings UI validates add, locks existing names, saves zero, deletes with confirmation', async () => {
  const h = settingsHarness([{ name: 'Gabriel', total: 15 }]);
  change(input(h.render(), '직원 이름'), ' New ');
  change(input(h.render(), '연간 연차'), '0');
  await submit(h.render());
  assert.equal(h.record.value[1].name, 'New');
  assert.equal(h.record.value[1].total, 0);
  button(h.render(), '설정 수정').props.onClick();
  assert.equal(input(h.render(), '직원 이름').props.readOnly, true);
  change(input(h.render(), '연간 연차'), '20');
  change(input(h.render(), '조정 사유'), 'annual review');
  await submit(h.render());
  assert.equal(h.record.value[0].name, 'Gabriel');
  assert.equal(h.record.value[0].total, 20);
  change(input(h.render(), '직원 이름'), 'Gabriel');
  change(input(h.render(), '연간 연차'), '1');
  await submit(h.render());
  assert.match(h.record.error.message, /고유/);
  assert.equal(h.saves.length, 2);
  button(h.render(), '설정 초안 취소').props.onClick();
  await button(h.render(), '설정 삭제').props.onClick();
  assert.equal(h.record.value.length, 1);
  assert.match(h.confirmations[0], /기존 내역과 수정 이력은 삭제하지 않습니다/);
});

test('settings failed/conflicted saves preserve draft, stale review required, deleted target never recreated', async () => {
  const h = settingsHarness([{ name: 'Gabriel', total: 15 }]);
  button(h.render(), '설정 수정').props.onClick();
  change(input(h.render(), '연간 연차'), '21');
  change(input(h.render(), '조정 사유'), 'review');
  h.record.saveImpl = async () => { throw Object.assign(Error('409 conflict'), { status: 409 }); };
  await submit(h.render());
  assert.equal(input(h.render(), '연간 연차').props.value, '21');
  assert.equal(h.record.value[0].total, 15);
  h.record.revision += 1;
  assert.equal(button(h.render(), '직원 설정 수정 · 공동 저장').props.disabled, true);
  await submit(h.render());
  assert.equal(h.saves.length, 1);
  h.record.value = [];
  button(h.render(), '설정 비교 완료 · 초안 재확인').props.onClick();
  await submit(h.render());
  assert.match(h.record.error.message, /삭제/);
  assert.equal(h.saves.length, 1);
  assert.equal(input(h.render(), '연간 연차').props.value, '21');
});

test('VacationPanel/PlantingPanel use defaults only when absent; historical deleted names remain editable', async () => {
  const vkey = helpers.checklistVacationKey(2026);
  const vacation = { id: 'v1', employee: 'Gabriel', start: '2026-10-07', end: '2026-10-07', days: 1, note: 'history' };
  const planting = { id: 'p1', variety: 'Polimnia', farm: 'Farm', boxes: 2, price: 0, createdAt: 1, note: 'history' };
  for (const [component, props, key, settingsKey, entry, field, amount] of [
    ['VacationPanel', { year: 2026 }, vkey, employeeKey, vacation, '휴가 일수', '2'],
    ['PlantingPanel', {}, helpers.SHARED_KEYS.planting, plantingKey, planting, '박스 수', '3'],
  ]) {
    const absent = harness(component, props);
    absent.render();
    assert(absent.records.get(settingsKey).value.length > 0);
    const empty = harness(component, props, { [key]: [], [settingsKey]: [] });
    const emptyTree = empty.render();
    assert.equal(nodes(emptyTree, row => row.type === 'option' && row.props.value && row.props.value !== 'all' && !['farm', 'variety'].includes(row.props.value)).length, 0);
    const h = harness(component, props, { [key]: [entry], [settingsKey]: [] });
    let tree = h.render();
    assert.match(text(tree), /기존 기록/);
    button(tree, '수정').props.onClick();
    change(input(h.render(), field), amount);
    await submit(h.render());
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].key, key);
    assert.equal(h.calls[0].value[0].id, entry.id);
    assert.equal(h.calls[0].value[0][component === 'VacationPanel' ? 'employee' : 'variety'], component === 'VacationPanel' ? entry.employee : entry.variety);
    assert.deepEqual(h.records.get(settingsKey).value, []);
  }
});

test('flight callback reports !banib only after loaded, preserves separate completion count and green rows', async () => {
  const counts = [];
  const rows = [{ id: 'f1', text: 'pending', llegado: true, banib: false }, { id: 'f2', text: 'complete', llegado: true, banib: true }, { id: 'f3', text: 'warehouse only', llegado: false, banib: true }];
  const h = harness('NotesPanel', { flights: true, onFlightCountChange: count => counts.push(count) }, { [helpers.SHARED_KEYS.flights]: rows });
  const tree = h.render();
  assert.deepEqual(counts, [1]);
  assert.match(text(tree), /1건 반입 대기/);
  assert.match(text(tree), /도착·반입 완료 1건/);
  assert.equal(nodes(tree, row => row.props?.className?.includes('flight-complete')).length, 1);
  const record = h.records.get(helpers.SHARED_KEYS.flights);
  record.loading = true;
  h.render();
  assert.deepEqual(counts, [1]);
  record.loading = false; record.error = 'GET failed';
  h.render();
  assert.deepEqual(counts, [1]);
  record.error = ''; record.value = rows.map(row => ({ ...row, banib: true }));
  h.render();
  assert.deepEqual(counts, [1, 0]);
  assert.match(uiSource, /<NotesPanel flights onFlightCountChange=\{onFlightCountChange\}/);
  assert.match(uiSource, /event\.ctrlKey\|\|event\.metaKey/);
  assert.match(uiSource, /event\.key==='Escape'/);
});

test('remaining adjustment requires bounded reason and computes quota without altering vacation records', () => {
  const config = [{ name: 'Gabriel', total: 15 }];
  const vacations = [vacationRow({ days: 2.5 }), vacationRow({ id: 'vacation-2', employee: 'Other', days: 99 })];
  const before = JSON.stringify(vacations);
  const next = helpers.adjustVacationRemaining(config, vacations, 'Gabriel', 0, ' balance correction ', 1);
  assert.deepEqual(next, [{ name: 'Gabriel', total: 2.5, adjustmentReason: 'balance correction', remainingAdjustment: { desiredRemaining: 0, expectedVacationRevision: 1 } }]);
  assert.equal(JSON.stringify(vacations), before);
  assert.deepEqual(config, [{ name: 'Gabriel', total: 15 }]);
  for (const remaining of [-1, NaN, Infinity, '', null]) assert.throws(() => helpers.adjustVacationRemaining(config, vacations, 'Gabriel', remaining, 'reason'));
  for (const reason of ['', ' ', 'a'.repeat(501), 'a\nb', {}, 1, null]) assert.throws(() => helpers.adjustVacationRemaining(config, vacations, 'Gabriel', 1, reason, 1));
  assert.throws(() => helpers.adjustVacationRemaining([], vacations, 'Gabriel', 1, 'reason'), /삭제/);
  assert.throws(() => helpers.validateEmployeeSettingsChange(config, [{ name: 'Gabriel', total: 20 }]), /사유/);
  assert.doesNotThrow(() => helpers.validateEmployeeSettingsChange(config, [{ name: 'Gabriel', total: 15 }]));
  assert.throws(() => helpers.validatePlantingSettings([{ name: 'P', target: 1, adjustmentReason: 'not allowed' }]));
});

test('server derives before/after/used/remaining/reason audit and authenticated account, rejects spoof and missing reason', () => withRoot(async root => {
  const vacations = [{ id: 'v', employee: 'Gabriel', start: '2026-10-07', end: '2026-10-07', days: 3.5, note: 'unchanged' }];
  await write(root, helpers.checklistVacationKey(2026), vacations);
  await write(root, employeeKey, helpers.EMPLOYEES);
  const unchanged = await readImportTeamRecord(helpers.checklistVacationKey(2026), { root });
  const config = await readImportTeamRecord(employeeKey, { root });
  await assert.rejects(write(root, employeeKey, [{ name: 'Gabriel', total: 20 }], 1), error => error.statusCode === 400 && /사유/.test(error.message));
  assert.deepEqual(await readImportTeamRecord(employeeKey, { root }), config);
  const next = helpers.adjustVacationRemaining(config.value, vacations, 'Gabriel', 4, 'carryover correction', 1);
  const saved = await write(root, employeeKey, next, 1);
  const event = saved.history.at(-1);
  assert.equal(event.userId, actor.userId);
  assert.equal(event.userName, actor.userName);
  assert.deepEqual(event.changes, [{ name: 'Gabriel', before: { name: 'Gabriel', total: 15 }, after: { name: 'Gabriel', total: 7.5, adjustmentReason: 'carryover correction' }, reason: 'carryover correction', used: 3.5, vacationRevision: 1, beforeRemaining: 11.5, afterRemaining: 4 }]);
  assert.equal(Object.hasOwn(saved.value[0], 'remainingAdjustment'), false);
  for (const patch of [{ changes: [] }, { userId: 'spoof' }, { beforeRemaining: 999 }, { actor }]) {
    await assert.rejects(write(root, employeeKey, [{ ...next[0], ...patch }], 2), error => error.statusCode === 400);
  }
  assert.deepEqual(await readImportTeamRecord(helpers.checklistVacationKey(2026), { root }), unchanged);
}));

test('remaining UI keeps failed draft, requires stale comparison, computes explicit zero and saves reason', async () => {
  const h = settingsHarness([{ name: 'Gabriel', total: 15 }]);
  const vacations = { value: [vacationRow({ id: 'v', days: 3 })], revision: 2, busy: false, error: null };
  const employee = helpers.vacationSummary(vacations.value, h.record.value)[0];
  const editor = harness('RemainingVacationEditor', { employee, settings: h.record, vacations });
  change(input(editor.render(), '원하는 잔여 일수'), '0');
  await submit(editor.render());
  assert.match(h.record.error.message, /사유/);
  assert.equal(h.saves.length, 0);
  change(input(editor.render(), '조정 사유'), 'zero balance');
  h.record.saveImpl = async () => { throw Object.assign(Error('conflict'), { status: 409 }); };
  await submit(editor.render());
  assert.equal(input(editor.render(), '원하는 잔여 일수').props.value, '0');
  assert.equal(input(editor.render(), '조정 사유').props.value, 'zero balance');
  vacations.revision += 1;
  assert.equal(button(editor.render(), '잔여 일수 조정 · 공동 저장').props.disabled, true);
  await submit(editor.render());
  assert.equal(h.saves.length, 1);
  button(editor.render(), '사용량·설정 비교 완료 · 초안 재확인').props.onClick();
  h.record.saveImpl = undefined;
  await submit(editor.render());
  assert.equal(h.record.value[0].total, 3);
  assert.equal(h.record.value[0].adjustmentReason, 'zero balance');
  assert.equal(input(editor.render(), '조정 사유').props.value, '');
  assert.deepEqual(vacations.value, [vacationRow({ id: 'v', days: 3 })]);
});

test('residual save rejects concurrently changed vacation revision and forged totals without touching settings/history', () => withRoot(async root => {
  const vacationKey = helpers.checklistVacationKey(2026);
  const old = [vacationRow({ id: 'v', days: 3 })];
  await write(root, vacationKey, old);
  await write(root, employeeKey, helpers.EMPLOYEES);
  const baseline = await readImportTeamRecord(employeeKey, { root });
  const draft = helpers.adjustVacationRemaining(baseline.value, old, 'Gabriel', 5, 'review', 1);
  await assert.rejects(writeImportTeamRecord(employeeKey, { value: draft, expectedRevision: 1, actor }, {
    root, _lockHooks: { afterInstall: async () => { await write(root, vacationKey, [{ ...old[0], days: 4 }], 1); } },
  }), error => error.statusCode === 409 && /휴가 내역/.test(error.message));
  assert.deepEqual(await readImportTeamRecord(employeeKey, { root }), baseline);
  const freshVacation = await readImportTeamRecord(vacationKey, { root });
  const fresh = helpers.adjustVacationRemaining(baseline.value, freshVacation.value, 'Gabriel', 5, 'review', freshVacation.revision);
  const forged = fresh.map(row => row.name === 'Gabriel' ? { ...row, total: 99 } : row);
  await assert.rejects(write(root, employeeKey, forged, 1), error => error.statusCode === 409 && /일치/.test(error.message));
  assert.deepEqual(await readImportTeamRecord(employeeKey, { root }), baseline);
  const saved = await write(root, employeeKey, fresh, 1);
  const change = saved.history.at(-1).changes[0];
  assert.equal(change.used, 4);
  assert.equal(change.vacationRevision, 2);
  assert.equal(change.afterRemaining, 5);
  assert.equal(saved.value[0].total, 9);
  assert.deepEqual(await readImportTeamRecord(vacationKey, { root }), freshVacation);
  assert(!(await fs.readdir(root)).some(name => name.endsWith('.lock')));
}));

test('residual metadata has exact bounded fields and cannot inject used/revision/actor audit', () => {
  const row = { name: 'Gabriel', total: 4, adjustmentReason: 'reason' };
  const valid = { desiredRemaining: 1, expectedVacationRevision: 2 };
  assert.doesNotThrow(() => validateImportTeamValue(employeeKey, [{ ...row, remainingAdjustment: valid }]));
  for (const metadata of [null, [], {}, { ...valid, used: 3 }, { ...valid, actor }, { ...valid, expectedVacationRevision: -1 }, { ...valid, expectedVacationRevision: 0.5 }, { ...valid, desiredRemaining: Infinity }, { ...valid, desiredRemaining: -1 }]) {
    assert.throws(() => validateImportTeamValue(employeeKey, [{ ...row, remainingAdjustment: metadata }]), error => error.statusCode === 400);
  }
  assert.throws(() => validateImportTeamValue(employeeKey, [{ name: 'Gabriel', total: 4, remainingAdjustment: valid }]), error => error.statusCode === 400);
});

test('vacation account history shows server-authored totals/residual/used/reason/actor and deletion is not zero', () => {
  const record = { history: [
    { revision: 2, at: '2026-10-07T01:00:00Z', userId: 'staff-a', userName: '<img>담당자', changes: [{ name: 'Gabriel', before: { name: 'Gabriel', total: 15 }, after: { name: 'Gabriel', total: 7.5 }, beforeRemaining: 11.5, afterRemaining: 4, used: 3.5, reason: 'carryover correction', vacationRevision: 1 }] },
    { revision: 3, at: '2026-10-07T02:00:00Z', userId: 'staff-b', userName: '삭제 담당자', changes: [{ name: 'Gabriel', before: { name: 'Gabriel', total: 7.5 }, after: null, beforeRemaining: 4, afterRemaining: null, used: 3.5, reason: null, vacationRevision: 1 }] },
  ] };
  const h = harness('VacationAdjustmentHistory', { record, year: 2026 });
  const tree = h.render(), content = text(tree);
  assert.match(content, /휴가 조정·계정 이력 · 2026년/);
  assert.match(content, /잔여: 11.5일 → 4일/);
  assert.match(content, /연간 연차: 15일 → 7.5일 · 당시 사용 3.5일/);
  assert.match(content, /사유: carryover correction/);
  assert.match(content, /계정 staff-a/);
  assert.match(content, /KST/);
  assert.match(content, /잔여: 4일 → 설정 삭제/);
  assert.doesNotMatch(content, /4일 → 0일/);
  assert(content.indexOf('저장 버전 3') < content.indexOf('저장 버전 2'));
  const html = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(html, /&lt;img&gt;/);
  assert.doesNotMatch(html, /<img>/);
  const panel = harness('VacationPanel', { year: 2026 }).render();
  assert(nodes(panel, node => typeof node.type === 'function' && node.type.name === 'VacationAdjustmentHistory').length === 1);
});

test('vacation rows strictly validate exact source shape, real dates/year, bounded days/name/note and legacy IDs', () => {
  const key = helpers.checklistVacationKey(2026);
  const valid = [vacationRow({ id: 1700000000000.5, employee: 'Historical employee', days: 0.5 }), vacationRow({ id: '12345678-1234-4234-8234-123456789abc', end: '2027-01-01', days: 366 })];
  assert.deepEqual(helpers.validateVacationEntries(valid, 2026), valid);
  assert.doesNotThrow(() => validateImportTeamValue(key, valid));
  const missingEnd = vacationRow(); delete missingEnd.end;
  const invalid = [null, {}, [], missingEnd, vacationRow({ actor }), vacationRow({ employee: '' }), vacationRow({ employee: ' padded ' }), vacationRow({ employee: 'a'.repeat(81) }),
    vacationRow({ employee: 'a\nb' }), vacationRow({ note: 'a'.repeat(2001) }), vacationRow({ note: 'x\u0000' }), vacationRow({ start: '2025-10-07', end: '2025-10-07' }),
    vacationRow({ start: '2026-02-30' }), vacationRow({ end: '2026-10-06' }), vacationRow({ end: '' }),
    ...[0, -1, 367, Number.MAX_VALUE, Infinity, NaN, '1', true, null].map(days => vacationRow({ days })),
    ...[null, 0, -1, Infinity, ' ', '../bad'].map(id => vacationRow({ id }))];
  for (const row of invalid) {
    assert.throws(() => helpers.validateVacationEntries([row], 2026));
    assert.throws(() => validateImportTeamValue(key, [row]), error => error.statusCode === 400);
  }
  for (const list of [[vacationRow(), vacationRow()], [vacationRow({ id: 1000 }), vacationRow({ id: '1000' })], Array.from({ length: 10001 }, (_, i) => vacationRow({ id: `v-${i}` }))]) {
    assert.throws(() => validateImportTeamValue(key, list), error => error.statusCode === 400);
  }
});

test('malformed vacation writes/read fail closed and cannot corrupt employee audit or existing record bytes', () => withRoot(async root => {
  const key = helpers.checklistVacationKey(2026);
  await write(root, key, [vacationRow({ days: 3 })]);
  const originalRecord = await readImportTeamRecord(key, { root });
  const settings = await write(root, employeeKey, helpers.EMPLOYEES);
  for (const value of [[null], [vacationRow({ days: -1 })], [vacationRow({ days: Number.MAX_VALUE })]]) {
    await assert.rejects(write(root, key, value, 1), error => error.statusCode === 400);
    assert.deepEqual(await readImportTeamRecord(key, { root }), originalRecord);
  }
  const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  const original = await fs.readFile(filename, 'utf8');
  for (const value of [[null], [vacationRow({ days: -1 })], [vacationRow({ days: 1e308 })]]) {
    const malformed = JSON.stringify({ ...JSON.parse(original), value });
    await fs.writeFile(filename, malformed);
    await assert.rejects(readImportTeamRecord(key, { root }), error => error.statusCode === 500);
    await assert.rejects(write(root, key, [vacationRow()], 1), error => error.statusCode === 500);
    const next = helpers.EMPLOYEES.map(row => row.name === 'Gabriel' ? { ...row, total: 16, adjustmentReason: 'review' } : row);
    await assert.rejects(write(root, employeeKey, next, 1), error => error.statusCode === 500);
    assert.equal(await fs.readFile(filename, 'utf8'), malformed);
    const currentSettings = await readImportTeamRecord(employeeKey, { root });
    assert.equal(currentSettings.revision, settings.revision);
    assert.deepEqual(currentSettings.history, settings.history);
  }
}));

test('legacy fractional numeric and UUID vacation IDs retain exact types through runtime CRUD', () => withRoot(async root => {
  const key = helpers.checklistVacationKey(2026);
  const rows = [vacationRow({ id: 1700000000000.5, days: 0.5 }), vacationRow({ id: '12345678-1234-4234-8234-123456789abc', employee: 'Removed employee', days: 2 })];
  await write(root, key, rows);
  assert.deepEqual((await readImportTeamRecord(key, { root })).value, rows);
  const changed = helpers.upsertEntry(rows, { ...rows[0], days: 1 });
  await write(root, key, changed, 1);
  const stored = await readImportTeamRecord(key, { root });
  assert.equal(typeof stored.value[0].id, 'number');
  assert.equal(stored.value[0].id, rows[0].id);
  assert.deepEqual(stored.value[1], rows[1]);
  await write(root, key, helpers.deleteEntry(stored.value, rows[0].id), 2);
  assert.deepEqual((await readImportTeamRecord(key, { root })).value, [rows[1]]);
}));

test('vacation used/total guards reject poisoned inputs and overflow rather than generating null audit numbers', () => {
  assert.equal(helpers.vacationDaysUsed([vacationRow({ days: 366 }), vacationRow({ id: 'v2', days: 0.5 })], 'Gabriel'), 366.5);
  for (const list of [[null], [vacationRow({ days: -1 })], [vacationRow({ days: 1e308 })], [vacationRow({ days: Infinity })]]) {
    assert.throws(() => helpers.vacationDaysUsed(list, 'Gabriel'));
    assert.throws(() => helpers.adjustVacationRemaining(helpers.EMPLOYEES, list, 'Gabriel', 1, 'reason', 1));
  }
  for (const [used, remaining] of [[Number.MAX_VALUE, Number.MAX_VALUE], [Infinity, 0], [0, Infinity], [-1, 1], [1, -1], ['1', 1]]) assert.throws(() => helpers.vacationAdjustedTotal(used, remaining));
  assert.equal(helpers.vacationAdjustedTotal(3.5, 0), 3.5);
});

test('planting exact source rows reject null, duplicates, spoof fields and invalid numeric values on write/read', () => withRoot(async root => {
  const key = helpers.SHARED_KEYS.planting;
  const row = { id: 1700000000000.5, createdAt: 1700000000000, variety: 'Historical variety', farm: 'Farm', boxes: 0.5, price: 0, note: '' };
  assert.doesNotThrow(() => validateImportTeamValue(key, [row]));
  await write(root, key, [row]);
  const valid = await readImportTeamRecord(key, { root });
  for (const value of [[null], [row, row], [{ ...row, actor }], [{ ...row, boxes: -1 }], [{ ...row, boxes: Infinity }], [{ ...row, price: -1 }], [{ ...row, createdAt: NaN }]]) {
    await assert.rejects(write(root, key, value, 1), error => error.statusCode === 400);
    assert.deepEqual(await readImportTeamRecord(key, { root }), valid);
  }
  const filename = path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  const malformed = JSON.stringify({ ...valid, value: [null] });
  await fs.writeFile(filename, malformed);
  await assert.rejects(readImportTeamRecord(key, { root }), error => error.statusCode === 500);
  assert.equal(await fs.readFile(filename, 'utf8'), malformed);
}));

test('handoff integration validates key and server history snapshots, archives beyond latest 50', () => withRoot(async root => {
  const key = 'checklist.handoffs';
  const row = { id: '12345678-1234-4234-8234-123456789abc', title: 'handoff', issue: 'issue', action: '', caution: '', checks: '', status: 'OPEN', priority: 'NORMAL' };
  assert.equal(validateImportTeamKey(key), key);
  assert.throws(() => validateImportTeamValue(key, null), error => error.statusCode === 400);
  await write(root, key, [row]);
  for (let revision = 1; revision <= 50; revision += 1) await write(root, key, [{ ...row, action: `action ${revision}` }], revision);
  const record = await readImportTeamRecord(key, { root });
  assert.equal(record.history.length, 50);
  assert.equal(record.history[0].revision, 2);
  assert.deepEqual(record.historyArchive, { eventCount: 1, throughRevision: 1 });
  assert.equal(record.history.at(-1).changes[0].before.action, 'action 49');
  assert.equal(record.history.at(-1).changes[0].after.action, 'action 50');
  assert.equal(record.history.at(-1).userId, actor.userId);
  const directory = path.join(root, 'history', createHash('sha256').update(key).digest('hex'));
  const archived = JSON.parse(await fs.readFile(path.join(directory, '000000000001.json'), 'utf8'));
  assert.deepEqual(archived.changes[0], { id: row.id, before: null, after: row });
  await assert.rejects(write(root, key, [{ ...row, userId: 'spoof' }], 51), error => error.statusCode === 400);
  assert.deepEqual(await readImportTeamRecord(key, { root }), record);
}));
