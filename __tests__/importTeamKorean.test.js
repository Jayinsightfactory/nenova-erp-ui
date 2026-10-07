import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as canonical from '../lib/importTeamChecklist.js';
import * as korean from '../lib/importTeamKorean.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/importTeamChecklistSource.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const uiSource = readFileSync(new URL('../components/import-tools/ChecklistTool.js', import.meta.url), 'utf8');
const compiled = babel.transformSync(uiSource + '\nexport { ChecksPanel, NotesPanel, VacationPanel, PlantingPanel };', {
  filename: 'ChecklistTool.js', babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code;

// Static, in-memory renders only: no network, ERP, browser storage, or writes.
function panel(name, props = {}, saved) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module, Date, Math,
    require(dependency) {
      if (dependency === 'react') return {
        ...React,
        useRef: value => ({ current: value }),
        useEffect: () => {},
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      };
      if (dependency === '../../lib/importTeamChecklist') return canonical;
      if (dependency === '../../lib/importTeamKorean') return korean;
      if (dependency === '../../lib/importTeamClient') return {
        useImportTeamRecord: (key, initial) => ({ key, value: key.startsWith('checklist.settings.') ? initial : saved ?? initial, revision: 12, loading: false, saving: false, reload: async () => {}, save: async () => {} }),
      };
      throw new Error(`Unexpected dependency: ${dependency}`);
    },
  });
  return module.exports[name](props);
}
function nodes(element) {
  if (!React.isValidElement(element)) return [];
  const children = [element.props.children].flat(Infinity);
  return [element, ...children.flatMap(nodes)];
}
const escaped = value => renderToStaticMarkup(React.createElement('span', null, value)).slice(6, -7);

test('all 113 canonical daily templates have explicit Korean display labels', () => {
  const texts = Object.values(canonical.TASKS).flatMap(Object.values).flat();
  assert.equal(texts.length, 113);
  for (const original of texts) {
    assert.equal(Object.hasOwn(korean.CHECKLIST_TASK_KO, original), true, original);
    assert.match(korean.checklistTaskLabel(original), /[가-힣]/, original);
  }
  assert.deepEqual(Object.keys(korean.CHECKLIST_TASK_KO).sort(), [...new Set(texts)].sort(), 'no stale/unused task mappings');
  assert.ok(Object.isFrozen(korean.CHECKLIST_TASK_KO));
});

test('all countries, seven days and six monthly templates are explicitly localized', () => {
  for (const country of new Set(Object.values(canonical.TASKS).flatMap(Object.keys))) {
    assert.equal(Object.hasOwn(korean.CHECKLIST_COUNTRY_KO, country), true, country);
    if (country !== 'Holex / EZ') assert.match(korean.checklistCountryLabel(country), /[가-힣]/);
  }
  canonical.DAYS.forEach((day, index) => {
    const expected = ['월', '화', '수', '목', '금', '토', '일'][index];
    assert.equal(korean.checklistWeekdayLabel(day), expected);
    assert.equal(korean.checklistWeekdayLabel(day, true), `${expected}요일`);
  });
  canonical.MONTHLY_TASKS.forEach(task => {
    assert.equal(Object.hasOwn(korean.CHECKLIST_MONTHLY_KO, task.desc), true, task.desc);
    assert.match(korean.checklistMonthlyLabel(task), new RegExp(`^${task.day}일 · .*[가-힣]`));
  });
});

test('localized renders preserve every canonical checkbox identity across all weekdays', () => {
  const before = JSON.stringify(canonical.TASKS);
  for (const day of canonical.weekDates('2026-10-06')) {
    const groups = canonical.dailyTasks(day.date);
    const tree = panel('ChecksPanel', { date: day.date });
    const labels = nodes(tree).filter(node => node.type === 'label' && node.props.className.startsWith('check-row'));
    assert.deepEqual(labels.map(node => node.key), groups.flatMap(group => group.tasks.map(task => task.key)));
    const html = renderToStaticMarkup(tree);
    for (const group of groups) {
      assert.ok(html.includes(escaped(korean.checklistCountryLabel(group.country))));
      for (const task of group.tasks) assert.ok(html.includes(escaped(korean.checklistTaskLabel(task.text))), task.text);
    }
    assert.ok(html.includes(korean.checklistWeekdayLabel(day, true)));
  }
  assert.equal(JSON.stringify(canonical.TASKS), before);
});

test('monthly Korean labels retain independent day-30 keys and saved checkbox values', () => {
  const tree = panel('ChecksPanel', { month: '2026-10' }, { day30_4: true, day30_5: false });
  const labels = nodes(tree).filter(node => node.type === 'label' && node.props.className.startsWith('check-row'));
  assert.deepEqual(labels.map(node => node.key), canonical.MONTHLY_TASKS.map(canonical.monthlyTaskKey));
  assert.equal(nodes(labels[4]).find(node => node.type === 'input').props.checked, true);
  assert.equal(nodes(labels[5]).find(node => node.type === 'input').props.checked, false);
  const html = renderToStaticMarkup(tree);
  for (const task of canonical.MONTHLY_TASKS) assert.ok(html.includes(escaped(korean.checklistMonthlyLabel(task))));
  assert.match(html, /월별 결제 · 콜롬비아/);
});

test('canonical source constants, shared record identities and progress calculations stay unchanged', () => {
  for (const name of ['TASKS', 'DAYS', 'MONTHLY_TASKS', 'EMPLOYEES', 'PLANT_VARIETIES']) assert.deepEqual(canonical[name], fixture[name]);
  assert.equal(canonical.checklistDayKey('2026-10-06'), 'checklist.day.2026-10-06');
  assert.equal(canonical.checklistMonthKey('2026-10'), 'checklist.month.2026-10');
  assert.equal(canonical.checklistVacationKey('2026'), 'checklist.vacations.2026');
  assert.deepEqual(canonical.SHARED_KEYS, { pending: 'checklist.pending', flights: 'checklist.flights', planting: 'checklist.planting', plantingSettings: 'checklist.settings.planting' });
  const saved = { 'Netherlands::0': true, 'General::0': true };
  assert.equal(canonical.checklistProgress('2026-10-06', saved).done, 2);
  const tree = panel('ChecksPanel', { date: '2026-10-06' }, saved);
  const checked = nodes(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked);
  assert.equal(checked.length, 2);
  assert.deepEqual(saved, { 'Netherlands::0': true, 'General::0': true });
});

test('user-authored content and canonical option values are rendered verbatim and safely', () => {
  const raw = 'Revisar total del pedido <img src=x onerror=alert(1)>';
  const pending = [{ id: 'p', text: raw, done: false }];
  const flights = [{ id: 'f', text: raw, llegado: true, banib: false }];
  const planting = [{ id: 's', variety: 'Polimnia', farm: 'General', boxes: 1, price: 0, note: raw, createdAt: 1 }];
  const vacation = [{ id: 'v', employee: 'Gabriel', start: '2026-10-06', end: '2026-10-06', days: 1, note: raw }];
  for (const [name, props, saved] of [
    ['NotesPanel', {}, pending], ['NotesPanel', { flights: true }, flights],
    ['PlantingPanel', {}, planting], ['VacationPanel', { year: '2026' }, vacation],
  ]) {
    const before = JSON.stringify(saved);
    const html = renderToStaticMarkup(panel(name, props, saved));
    assert.ok(html.includes(escaped(raw)), name);
    assert.doesNotMatch(html, /<img/);
    assert.equal(JSON.stringify(saved), before, name);
  }
  const plantingHtml = renderToStaticMarkup(panel('PlantingPanel', {}, planting));
  assert.match(plantingHtml, /General/);
  assert.doesNotMatch(plantingHtml, /공통 업무/);
  for (const variety of canonical.PLANT_VARIETIES) assert.ok(plantingHtml.includes(escaped(variety.name)));
  const vacationHtml = renderToStaticMarkup(panel('VacationPanel', { year: '2026' }, vacation));
  for (const employee of canonical.EMPLOYEES) assert.ok(vacationHtml.includes(escaped(employee.name)));
});

test('known validation errors are Korean and unknown labels remain unchanged', () => {
  for (const [original, translated] of Object.entries(korean.CHECKLIST_ERROR_KO)) {
    assert.equal(korean.checklistErrorLabel(canonical.checklistErrorMessage(new Error(original))), translated);
    assert.match(translated, /[가-힣]/);
  }
  for (const original of ['Unmapped task', '__proto__', 'constructor', '원문 메모']) {
    assert.equal(korean.checklistTaskLabel(original), original);
    assert.equal(korean.checklistCountryLabel(original), original);
    assert.equal(korean.checklistErrorLabel(original), original);
  }
  assert.match(korean.checklistErrorLabel(canonical.checklistErrorMessage({ status: 409, message: '저장 실패' })), /최신 상태.*초안과 비교/);
});

test('UI remains responsive with page scroll, distinct states and visible keyboard focus', () => {
  assert.match(uiSource, /color:#172b4d/);
  assert.match(uiSource, /background:#2457c5/);
  assert.match(uiSource, /font-size:14px/);
  assert.match(uiSource, /min-height:36px/);
  assert.match(uiSource, /\.record-list \{ margin-top:12px; padding:2px; \}/);
  assert.doesNotMatch(uiSource, /max-height:480px; overflow:auto/);
  assert.match(uiSource, /@media\(max-width:900px\)/);
  assert.match(uiSource, /:focus-visible/);
  for (const state of ['status-success', 'status-warning', 'status-error']) assert.ok(uiSource.includes(state));
  assert.doesNotMatch(uiSource, /width:\s*1920px|height:\s*1080px|dangerouslySetInnerHTML|localStorage|fetch\(/);
  for (const name of ['NotesPanel', 'VacationPanel', 'PlantingPanel']) {
    assert.ok(nodes(panel(name, name === 'VacationPanel' ? { year: '2026' } : {})).some(node => node.props.role === 'region' && node.props.tabIndex === 0));
  }
});
