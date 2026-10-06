import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as helpers from '../lib/importTeamChecklist.js';
import { validateImportTeamKey, validateImportTeamValue } from '../lib/importTeamStore.js';

const root = new URL('../', import.meta.url);
const sourceFixture = JSON.parse(readFileSync(new URL('fixtures/importTeamChecklistSource.json', import.meta.url), 'utf8'));
let source = null;
try {
  source = readFileSync(new URL('output/import-tool-sources/Import_Team_Checklist_Diario_2.html', root), 'utf8');
} catch (error) {
  // The local reference HTML is deliberately ignored by Git. Only the optional
  // reference comparison may be skipped; fixture and behavior tests always run.
  if (error.code !== 'ENOENT') throw error;
}
const uiSource = readFileSync(new URL('components/import-tools/ChecklistTool.js', root), 'utf8');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function sourceConstant(name) {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0);
  const end = source.indexOf(';', start);
  return JSON.parse(JSON.stringify(vm.runInNewContext(source.slice(start, end + 1) + `\n${name}`)));
}

test('all task text, weekday categories, monthly tasks and options match tracked source fixture', () => {
  for (const name of ['TASKS', 'DAYS', 'MONTHLY_TASKS', 'EMPLOYEES', 'PLANT_VARIETIES']) {
    assert.deepEqual(helpers[name], sourceFixture[name], name);
  }
  assert.equal(Object.values(helpers.TASKS).flatMap(Object.values).flat().length, 113);
});

test('optional local original HTML matches tracked source fixture', {
  skip: source === null ? 'Ignored local original HTML is absent; all fixture and behavior tests still run.' : false,
}, () => {
  for (const name of ['TASKS', 'DAYS', 'MONTHLY_TASKS', 'EMPLOYEES', 'PLANT_VARIETIES']) {
    assert.deepEqual(sourceFixture[name], sourceConstant(name), name);
  }
});

test('KST default and real-date keys isolate same weekdays, next weeks and years', () => {
  assert.equal(helpers.getKstDate('2026-10-05T15:00:00Z'), '2026-10-06');
  assert.equal(helpers.getKstDate('2026-10-05T14:59:59Z'), '2026-10-05');
  assert.equal(helpers.getKstDate('2025-12-31T15:00:00Z'), '2026-01-01');
  assert.equal(helpers.weekdayForDate('2026-10-06').id, 'martes');
  assert.equal(helpers.weekdayForDate('2026-10-13').id, 'martes');
  assert.notEqual(helpers.checklistDayKey('2026-10-06'), helpers.checklistDayKey('2026-10-13'));
  assert.notEqual(helpers.checklistDayKey('2025-10-06'), helpers.checklistDayKey('2026-10-06'));
  assert.notEqual(helpers.checklistMonthKey('2025-10'), helpers.checklistMonthKey('2026-10'));
  assert.notEqual(helpers.checklistVacationKey(2025), helpers.checklistVacationKey(2026));
  assert.deepEqual(helpers.weekDates('2026-01-01').map(day => day.date), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  for (const invalid of ['martes', '2026-02-29', '2026-13-01', '2026-1-01', 'x']) assert.throws(() => helpers.checklistDayKey(invalid));
  assert.equal(helpers.isDate('2024-02-29'), true);
  assert.throws(() => helpers.checklistMonthKey('2026-00'));
  assert.throws(() => helpers.checklistVacationKey('2026.5'));
  const key = helpers.dailyTasks('2026-10-06')[0].tasks[0].key;
  const records = { [helpers.checklistDayKey('2026-10-06')]: { [key]: true } };
  assert.equal(helpers.checklistProgress('2026-10-06', records['checklist.day.2026-10-06']).done, 1);
  assert.equal(helpers.checklistProgress('2026-10-13', records['checklist.day.2026-10-13']).done, 0);
  assert.equal(helpers.checklistProgress('2026-10-06', { unknown: true }).done, 0);
});

test('source monthly day-30 entries remain independently checkable', () => {
  assert.notEqual(helpers.monthlyTaskKey(helpers.MONTHLY_TASKS[4], 4), helpers.monthlyTaskKey(helpers.MONTHLY_TASKS[5], 5));
  assert.equal(helpers.monthlyTaskKey(helpers.MONTHLY_TASKS[4], 4), 'day30_4');
});

test('Korean flight parsing preserves time/date fallback and 60-day rollover in KST', () => {
  const now = new Date('2026-05-29T00:00:00Z');
  assert.equal(helpers.parseFlightDate('22-2차 콜수국 (POLAR)\n5월 30일(토) 12:15 도착 예정\n(992-01527724 PO947 353 BOX)', now), Date.parse('2026-05-30T12:15:00+09:00'));
  assert.equal(helpers.parseFlightDate('5월 30일 도착', now), Date.parse('2026-05-30T00:00:00+09:00'));
  assert.equal(helpers.parseFlightDate('1월 1일 09:00', now), Date.parse('2027-01-01T09:00:00+09:00'));
  assert.equal(helpers.parseFlightDate('12월 31일 23:00', new Date('2027-01-01T00:00:00Z')), Date.parse('2027-12-31T23:00:00+09:00'));
  const threshold = Date.parse('2026-03-30T00:00:00+09:00') + 60 * 86400000;
  assert.equal(helpers.parseFlightDate('3월 30일', new Date(threshold)), Date.parse('2026-03-30T00:00:00+09:00'));
  assert.equal(helpers.parseFlightDate('3월 30일', new Date(threshold + 1)), Date.parse('2027-03-30T00:00:00+09:00'));
  for (const invalid of ['', 'schedule unknown', '13월 1일', '2월 30일', '5월 30일 24:01', '5월 30일 12:60']) assert.equal(helpers.parseFlightDate(invalid, now), Infinity, invalid);
  const flights = [{ id: 1, text: 'no date' }, { id: 2, text: '5월 31일' }, { id: 3, text: '5월 30일' }, { id: 4, text: '' }];
  assert.deepEqual(helpers.sortFlights(flights, now).map(row => row.id), [3, 2, 1, 4]);
  assert.deepEqual(flights.map(row => row.id), [1, 2, 3, 4], 'sort does not mutate the saved array');
});

test('vacation CRUD and manual-day calculation preserve source employee limits', () => {
  const entry = { id: 'vac1', ...helpers.validateVacation({ employee: 'Gabriel', start: '2026-10-06', end: '', days: '0.5', note: ' 휴가 ' }, 2026) };
  assert.equal(entry.end, entry.start);
  assert.equal(entry.days, 0.5);
  assert.equal(entry.note, '휴가');
  const list = helpers.upsertEntry([], entry);
  const edited = helpers.upsertEntry(list, { ...entry, days: 16 });
  assert.equal(list[0].days, 0.5);
  assert.equal(edited.length, 1);
  assert.deepEqual(helpers.deleteEntry(edited, entry.id), []);
  const summary = helpers.vacationSummary(edited);
  assert.equal(summary[0].remaining, -1);
  assert.equal(summary[0].status, 'danger');
  assert.equal(summary[0].percent, 0);
  assert.equal(summary[2].remaining, 11);
  assert.equal(helpers.vacationSummary([{ ...entry, days: 11 }])[0].status, 'warning');
  for (const patch of [{ employee: 'unknown' }, { start: '2025-10-06' }, { end: '2026-10-01' }, { days: 0 }, { days: Infinity }, { start: '2026-02-30' }]) assert.throws(() => helpers.validateVacation({ ...entry, ...patch }, 2026));
});

test('planting array CRUD, fractional boxes, explicit zero price, canonical grouping and calculations', () => {
  const entry = { id: 'plant1', createdAt: 1, ...helpers.validatePlanting({ variety: 'Polimnia', farm: ' Finca ', boxes: '50.5', price: '0', note: ' note ' }) };
  assert.equal(entry.price, 0);
  assert.equal(entry.boxes, 50.5);
  assert.equal(entry.farm, 'Finca');
  const list = helpers.upsertEntry([], entry);
  const summary = helpers.plantingSummary(list)[0];
  assert.equal(summary.remaining, -0.5);
  assert.equal(summary.status, 'over');
  assert.equal(summary.percent, 100);
  assert.equal(helpers.plantingSummary([{ ...entry, boxes: 50 }])[0].status, 'complete');
  assert.equal(helpers.plantingSummary([{ ...entry, boxes: 25 }])[0].percent, 50);
  assert.equal(helpers.fmtUSD(1.234), '$1.234');
  assert.equal(helpers.fmtUSD(0), '$0.00');
  const rows = [entry, { ...entry, id: 'plant2', variety: 'Cherrio', farm: '__proto__', boxes: 3, createdAt: 2 }];
  assert.deepEqual(helpers.groupPlanting(rows, 'variety').map(group => group.name), ['Polimnia', 'Cherrio']);
  assert.equal(helpers.groupPlanting(rows, 'all')[0].boxes, 53.5);
  assert.deepEqual(helpers.groupPlanting(rows, 'all')[0].entries.map(row => row.id), ['plant2', 'plant1']);
  assert.equal(helpers.groupPlanting(rows, 'farm').length, 2);
  assert.deepEqual(helpers.deleteEntry(rows, 'plant2'), [entry]);
  for (const patch of [{ variety: 'unknown' }, { farm: ' ' }, { boxes: 0 }, { boxes: -1 }, { price: -1 }, { price: '' }, { price: ' ' }, { price: Infinity }]) assert.throws(() => helpers.validatePlanting({ ...entry, ...patch }));
});

test('all record keys and value shapes match the actual main store validators', () => {
  const records = [
    [helpers.checklistDayKey('2026-10-06'), { 'Netherlands::0': true, 'General::0': false }],
    [helpers.checklistMonthKey('2026-10'), { day30_4: true, day30_5: false }],
    [helpers.SHARED_KEYS.pending, [{ id: 'p', text: '원문', done: false }]],
    [helpers.SHARED_KEYS.flights, [{ id: 'f', text: '항공', llegado: true, banib: false }]],
    [helpers.checklistVacationKey(2026), [{ id: 'v', employee: 'Gabriel', start: '2026-10-06', end: '2026-10-06', days: 0.5, note: '' }]],
    [helpers.SHARED_KEYS.planting, [{ id: 's', createdAt: 1, variety: 'Polimnia', farm: 'f', boxes: 1, price: 0, note: '' }]],
  ];
  for (const [key, value] of records) {
    assert.equal(validateImportTeamKey(key), key);
    assert.doesNotThrow(() => validateImportTeamValue(key, value));
    assert.doesNotThrow(() => validateImportTeamValue(key, null));
  }
});

test('save acknowledgment happens only after resolution; rejection preserves a draft', async () => {
  let resolve;
  let draft = { text: 'keep me' };
  const promise = helpers.saveChecklistDraft(() => new Promise(done => { resolve = done; }), draft, () => { draft = null; });
  assert.deepEqual(draft, { text: 'keep me' });
  resolve();
  await promise;
  assert.equal(draft, null);
  draft = { text: 'retry me' };
  await assert.rejects(helpers.saveChecklistDraft(async () => { throw new Error('409 conflict'); }, draft, () => { draft = null; }));
  assert.deepEqual(draft, { text: 'retry me' });
  assert.match(helpers.checklistErrorMessage(Object.assign(new Error('failed'), { status: 409 })), /최신 상태/);
  assert.match(helpers.checklistErrorMessage('다른 직원이 먼저 수정했습니다. 새로고침하여 변경 내역을 확인하세요.'), /초안과 비교/);
});

// In-memory React hook harness: executes real component handlers without network,
// writing runtime records, installing test dependencies, or running the full build.
const babel = require('next/dist/compiled/babel/core');
const compiled = babel.transformSync(uiSource + '\nexport { ChecksPanel, NotesPanel, VacationPanel, PlantingPanel };', {
  filename: 'ChecklistTool.js', babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code;

function harness(componentName, props, initial = []) {
  const slots = [];
  let cursor = 0;
  const calls = [];
  const record = { value: initial, loading: false, saving: false, error: '', revision: 1, reload: async () => {} };
  let saveImpl = async () => {};
  record.save = async next => { calls.push(next); await saveImpl(next); record.value = next; record.revision += 1; };
  const hooks = {
    ...React,
    useState(init) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(init) { const index = cursor++; if (!(index in slots)) slots[index] = { current: init }; return slots[index]; },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module, Date, Math,
    window: { confirm: () => true },
    require(name) {
      if (name === 'react') return hooks;
      if (name === '../../lib/importTeamChecklist') return helpers;
      if (name === '../../lib/importTeamClient') return { useImportTeamRecord: (key, initialValue) => ({ ...record, value: record.value ?? initialValue }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    record, calls,
    setSave(implementation) { saveImpl = implementation; },
    render() { cursor = 0; return module.exports[componentName](props); },
    html() { return renderToStaticMarkup(this.render()); },
  };
}
function nodes(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
}
const find = (tree, predicate) => { const node = nodes(tree).find(predicate); assert.ok(node, 'requested UI element exists'); return node; };
const button = (tree, text) => find(tree, node => node.type === 'button' && String(node.props.children).includes(text));
function changeField(h, label, value) {
  const tree = h.render();
  const wrapper = find(tree, node => node.type === 'label' && React.Children.toArray(node.props.children)[0] === label);
  const input = find(wrapper, node => ['input', 'select', 'textarea'].includes(node.type));
  input.props.onChange({ target: { value } });
}
const submit = h => find(h.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('daily UI preserves checked draft on failure/reload, blocks stale overwrite, clears only on success', async () => {
  const h = harness('ChecksPanel', { date: '2026-10-06' }, {});
  const checkbox = find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox');
  checkbox.props.onChange({ target: { checked: true } });
  h.setSave(async () => { throw new Error('다른 직원이 먼저 수정했습니다.'); });
  await button(h.render(), '초안 공동 저장').props.onClick();
  assert.match(h.html(), /미저장 초안/);
  assert.match(h.html(), /다른 팀원이 수정했습니다/);
  assert.equal(find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox').props.checked, true);
  assert.deepEqual(h.record.value, {});
  h.record.reload = async () => { h.record.value = { 'General::0': true }; h.record.revision = 4; };
  const status = find(h.render(), node => typeof node.type === 'function' && node.type.name === 'RecordStatus');
  await status.props.record.reload();
  assert.equal(button(h.render(), '초안 공동 저장').props.disabled, true);
  assert.match(h.html(), /공동 상태가 바뀌었습니다/);
  button(h.render(), '비교 완료').props.onClick();
  let finish;
  h.setSave(() => new Promise(resolve => { finish = resolve; }));
  const saving = button(h.render(), '초안 공동 저장').props.onClick();
  assert.match(h.html(), /공동 저장 중/);
  assert.doesNotMatch(h.html(), /공동 저장 완료/);
  assert.equal(button(h.render(), '초안 공동 저장').props.disabled, true);
  const duplicate = button(h.render(), '초안 공동 저장').props.onClick();
  await duplicate;
  assert.equal(h.calls.length, 2, 'immediate lock prevents a second request');
  finish();
  await saving;
  assert.match(h.html(), /공동 저장 완료/);
  assert.doesNotMatch(h.html(), /미저장 초안/);
});

test('pending UI keeps form text on failure and displays it as escaped React text after success', async () => {
  const h = harness('NotesPanel', {}, []);
  const malicious = '<img src=x onerror=alert(1)> 한국어';
  changeField(h, '미결 업무', malicious);
  h.setSave(async () => { throw new Error('offline'); });
  await submit(h);
  assert.equal(find(h.render(), node => node.type === 'textarea').props.value, malicious);
  assert.equal(h.record.value.length, 0);
  h.setSave(async () => {});
  await submit(h);
  assert.equal(h.record.value[0].text, malicious);
  assert.equal(h.record.value[0].done, false);
  assert.equal(find(h.render(), node => node.type === 'textarea').props.value, '');
  assert.match(h.html(), /&lt;img/);
  assert.doesNotMatch(h.html(), /<img/);
  button(h.render(), '수정').props.onClick();
  changeField(h, '미결 업무', 'updated');
  await submit(h);
  assert.equal(h.record.value.length, 1);
  assert.equal(h.record.value[0].text, 'updated');
  await button(h.render(), 'Eliminar').props.onClick();
  // The delete handler deliberately returns void; allow the async save to settle.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.record.value.length, 0);
});

test('flight status does not show arrived/warehouse success until save resolves', async () => {
  const h = harness('NotesPanel', { flights: true }, [{ id: 'f', text: '10월 6일 12:15', llegado: false, banib: false }]);
  let finish;
  h.setSave(() => new Promise(resolve => { finish = resolve; }));
  const flightCheckbox = find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox');
  const promise = flightCheckbox.props.onChange({ target: { checked: true } });
  assert.equal(h.record.value[0].llegado, false);
  assert.equal(find(h.render(), node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  finish(); await promise;
  assert.equal(h.record.value[0].llegado, true);
  assert.equal(h.record.value[0].banib, false);
});

test('vacation form validation and save failures keep draft; successful CRUD respects year and limits', async () => {
  const h = harness('VacationPanel', { year: '2026' }, []);
  changeField(h, 'Inicio', '2025-10-06');
  changeField(h, 'Días', '0.5');
  await submit(h);
  assert.equal(h.calls.length, 0);
  assert.match(h.html(), /시작일의 연도/);
  changeField(h, 'Inicio', '2026-10-06');
  changeField(h, 'Nota', '휴가 초안');
  h.setSave(async () => { throw new Error('409 revision conflict'); });
  await submit(h);
  assert.match(h.html(), /휴가 초안/);
  assert.equal(h.record.value.length, 0);
  h.setSave(async () => {});
  await submit(h);
  assert.equal(h.record.value[0].days, 0.5);
  assert.equal(h.record.value[0].start, '2026-10-06');
  assert.equal(helpers.vacationSummary(h.record.value)[0].remaining, 14.5);
  const originalId = h.record.value[0].id;
  button(h.render(), '수정').props.onClick();
  changeField(h, 'Días', '2');
  await submit(h);
  assert.equal(h.record.value[0].id, originalId);
  assert.equal(h.record.value[0].days, 2);
  button(h.render(), 'Eliminar').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.record.value, []);
});

test('planting UI uses array, preserves failed form, zero USD price and stable edit identity', async () => {
  const h = harness('PlantingPanel', {}, []);
  changeField(h, 'Finca', 'Farm');
  changeField(h, 'Cajas', '50.5');
  changeField(h, 'USD / tallo', '0');
  h.setSave(async () => { throw new Error('offline'); });
  await submit(h);
  assert.equal(h.record.value.length, 0);
  assert.match(h.html(), /value="50.5"/);
  h.setSave(async () => {});
  await submit(h);
  assert.ok(Array.isArray(h.record.value));
  assert.equal(h.record.value[0].price, 0);
  const original = { ...h.record.value[0] };
  button(h.render(), '수정').props.onClick();
  changeField(h, 'Cajas', '25');
  await submit(h);
  assert.equal(h.record.value[0].id, original.id);
  assert.equal(h.record.value[0].createdAt, original.createdAt);
  assert.equal(h.record.value[0].boxes, 25);
  assert.match(h.html(), /\$0.00/);
  assert.match(h.html(), /USD\/tallo/);
});

test('loading and hook errors are exposed, reload is available, and controls block saves', () => {
  const h = harness('ChecksPanel', { month: '2026-10' }, {});
  h.record.loading = true;
  assert.match(h.html(), /불러오는 중/);
  assert.equal(button(h.render(), '초안 공동 저장').props.disabled, true);
  h.record.loading = false;
  h.record.error = '공동 자료를 읽지 못했습니다';
  assert.match(h.html(), /role="alert"/);
  assert.match(h.html(), /공동 자료를 읽지 못했습니다/);
  assert.match(h.html(), /최신 상태 다시 불러오기/);
});

test('native component has no HTML injection/storage/ERP writes and retains keyed visited panels', () => {
  assert.doesNotMatch(uiSource, /dangerouslySetInnerHTML|innerHTML|localStorage|iframe|fetch\(|mssql/);
  assert.match(uiSource, /import \{useImportTeamRecord\} from '\.\.\/\.\.\/lib\/importTeamClient'/);
  assert.match(uiSource, /dates\.map\(value => <div hidden=\{date !== value\} key=\{value\}/);
  assert.match(uiSource, /months\.map\(value => <div hidden=\{month !== value\} key=\{value\}/);
  assert.match(uiSource, /years\.map\(value => <div hidden=\{year !== value\} key=\{value\}/);
  assert.match(uiSource, /repeat\(auto-fit,minmax\(min\(100%,280px\),1fr\)\)/);
  assert.doesNotMatch(uiSource, /width:\s*1920px|height:\s*1080px/);
  const h = harness('default', {}, []);
  const before = h.render();
  const dateInput = find(before, node => node.type === 'input' && node.props.type === 'date');
  const originalDate = dateInput.props.value;
  dateInput.props.onChange({ target: { value: '2025-10-06' } });
  const after = h.render();
  const dayPanels = nodes(after).filter(node => typeof node.type === 'function' && node.type.name === 'ChecksPanel' && node.props.date);
  assert.deepEqual(dayPanels.map(node => node.props.date), [originalDate, '2025-10-06']);
  assert.equal(find(after, node => node.type === 'input' && node.props.type === 'date').props.value, '2025-10-06');
});
