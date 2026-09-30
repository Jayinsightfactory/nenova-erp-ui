import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as helper from '../lib/weekdayHorizontalMatrix.js';
import { SHIPPING_DAYS, shiftDate } from '../lib/weekdayEstimateCycle.js';

const { buildHorizontalWeekdayMatrix: build, horizontalEditPayload: edit,
  horizontalPrintReason: printReason, validateHorizontalQuantity: validate } = helper;
const cycles = [-1, 0, 1].map((offset) => ({ offset, year: 2026, majorWeek: String(38 + offset),
  startDate: shiftDate('2026-09-17', offset * 7), endDate: shiftDate('2026-09-17', offset * 7 + 6), calendarState: 'FOUND',
  days: SHIPPING_DAYS.map((day, index) => ({ ...day, date: shiftDate('2026-09-17', offset * 7 + index),
    orderWeek: `${38 + offset}-${day.suffix}`, calendarState: 'FOUND' })) }));
const actual = (patch = {}) => ({ year: 2026, orderWeek: '38-01', prodKey: 101, prodName: 'CARNATION Blue',
  flowerName: 'CARNATION', outUnit: 'BOX', shipmentOutQuantity: 4, fixed: true,
  shipmentDates: [{ date: '2026-09-17', shipmentQuantity: 4 }], ...patch });
const plan = (patch = {}) => ({ id: 'F3', year: 2026, orderWeek: '38-01', prodKey: 101,
  prodName: 'CARNATION Blue', unit: '박스', quantity: 6, date: '2026-09-17',
  sourceYear: 2026, sourceOrderWeek: '39-01', wdetailKey: 88, ...patch });

const frozen = JSON.stringify(cycles);
const matrix = build([cycles[2], cycles[0], cycles[1]], [plan({ prodKey: 303, prodName: 'ROSE Red', orderWeek: '39-01', date: '2026-09-24' })], [
  actual(), actual({ prodKey: 202, prodName: 'LILY White', orderWeek: '37-01', shipmentDates: [{ date: '2026-09-10', shipmentQuantity: 4 }] }),
  actual({ year: 2025, shipmentOutQuantity: 999, outUnit: '단' }),
  actual({ year: 2025, prodKey: 999 }), actual({ orderWeek: '40-01', prodKey: 888 }),
]);
assert.deepEqual(matrix.cycles.map((cycle) => cycle.offset), [-1, 0, 1]);
assert.equal(matrix.columns.length, 24);
assert.deepEqual(matrix.columns.map((column) => column.kind), Array.from({ length: 3 }, () => [...Array(7).fill('day'), 'total']).flat());
assert.deepEqual(matrix.columns.filter((column) => column.kind === 'day').slice(0, 7).map((column) => column.day.label), ['목', '금', '토', '일', '월', '화', '수']);
assert.deepEqual(matrix.rows.map((row) => row.prodKey).sort(), [101, 202, 303], 'union includes all three cycles, not prior-year/outside identities');
assert.equal(matrix.rows.filter((row) => row.prodKey === 101).length, 1);
assert.equal(matrix.rows[0].blocks[1].currentTotal, 4, 'prior-year quantity and unit excluded');
assert.equal(matrix.outsideComparisons.length, 3);
assert.equal(JSON.stringify(cycles), frozen, 'input calendar remains unchanged');
const prioritySource=[
  actual({prodKey:501,state:'NO_SHIPMENT',shipmentOutQuantity:null,shipmentDates:[]}),
  actual({prodKey:502,orderWeek:'37-01',shipmentDates:[{date:'2026-09-10',shipmentQuantity:4}]}),
  actual({prodKey:503,shipmentOutQuantity:0,shipmentDates:[]}),
  actual({prodKey:504}),
];
const prioritySnapshot=JSON.stringify(prioritySource);
const prioritized=build(cycles,[plan({prodKey:505})],prioritySource);
assert.deepEqual(prioritized.rows.map(row=>row.prodKey),[503,504,505,502,501],'current work then adjacent work then order-only; stable equal priority');
assert.equal(prioritized.rows.length,5,'order-only products remain available, not hidden');
assert.equal(prioritized.rows[0].blocks[1].currentTotal,0,'zero/cancelled distribution remains visible');
assert.equal(JSON.stringify(prioritySource),prioritySnapshot,'sorting never mutates ERP input');

const blockFor = (plans = [], comparisons = [actual()]) => build(cycles, plans, comparisons).rows[0].blocks[1];
const rowFor = (plans = [], comparisons = [actual()]) => build(cycles, plans, comparisons).rows[0];
const healthy = blockFor([plan()]);
assert.equal(healthy.days[0].current, 4);
assert.equal(healthy.days[0].planned, 6);
assert.equal(healthy.days[0].delta, 2);
assert.equal(healthy.days[1].current, null, 'absent date is NULL, not zero');
assert.equal(healthy.days[1].remaining, null);
assert.equal(healthy.unit, '박스', 'fixed aliases only');
assert.deepEqual(rowFor().flowerNames, ['CARNATION']);

const noShipment = blockFor([], [actual(), actual({ orderWeek: '38-02', state: 'NO_SHIPMENT', shipmentOutQuantity: null, shipmentDates: [] })]);
assert.equal(noShipment.days[0].current, 4, 'null other subweek does not erase valid dated quantity');
assert.equal(noShipment.currentTotal, 4);
assert.equal(noShipment.days[4].current, null);
assert.equal(blockFor([], [actual({ shipmentOutQuantity: null })]).days[0].current, 4, 'dated quantity remains valid independently of detail total');
assert.equal(blockFor([], [actual({ shipmentDates: [{ date: '2026-09-17', shipmentQuantity: 0 }] })]).days[0].current, 0);
assert.equal(blockFor([], [actual({ shipmentDates: [{ date: '2026-09-17', shipmentQuantity: null }] })]).days[0].current, null);

const outside = blockFor([plan({ date: '2026-10-01' })], [actual({ shipmentDates: [
  { date: '2026-09-17', shipmentQuantity: 1 }, { date: '2026-09-27', shipmentQuantity: 3 }, { date: '2026-02-30', shipmentQuantity: 2 },
] })]);
assert.equal(outside.days[0].current, 1);
assert.equal(outside.outside.length, 2);
assert.equal(outside.outside[1].originalDate, '2026-02-30');
assert.equal(outside.outsideDrafts.length, 1);
assert.equal(outside.currentTotal, 4);
assert.equal(outside.plannedTotal, 6);

const legacyRow = rowFor([], [actual({ orderWeek: '38-02' })]);
const legacyBlock = legacyRow.blocks[1];
assert.equal(legacyBlock.days[0].assignedWeekMismatch, true);
assert.equal(legacyBlock.days[0].effectiveOrderWeek, '38-02');
assert.deepEqual(edit(legacyRow, legacyBlock, legacyBlock.days[0], '0'), {
  prodKey: 101, prodName: 'CARNATION Blue', unit: '박스', year: 2026, orderWeek: '38-02', date: '2026-09-17', quantity: 0,
});
assert.equal(edit(legacyRow, legacyBlock, legacyBlock.days[1], '5').orderWeek, '38-01', 'absent actual date uses calendar full week');
assert.equal(edit(legacyRow, legacyBlock, legacyBlock.days[0], ''), null);
const ambiguous = blockFor([], [actual(), actual({ orderWeek: '38-02' })]);
assert.equal(ambiguous.days[0].current, null, 'different actual business keys are not merged');
assert.equal(ambiguous.days[0].actualDetails.length, 2);
assert.match(ambiguous.days[0].editDisabledReason, /업무차수 복수/);
assert.throws(() => edit(rowFor(), ambiguous, ambiguous.days[0], 1), /업무차수 복수/);
const duplicate = blockFor([plan(), plan({ id: 'F4' })]);
assert.equal(duplicate.days[0].planned, null);
assert.match(duplicate.days[0].editDisabledReason, /초안 2건/);
assert.throws(() => edit(rowFor(), duplicate, duplicate.days[0], 1), /초안 2건/);
for (const unit of ['단', null, 'unknown']) {
  const mixed = blockFor([plan({ unit })]);
  assert.equal(mixed.unitState, 'REVIEW');
  assert.equal(mixed.days[0].planned, null);
  assert.equal(mixed.days[0].delta, null);
  assert.match(mixed.days[0].editDisabledReason, /단위/);
}
const mismatchedPlan = blockFor([plan({ orderWeek: '38-02' })]);
assert.match(mismatchedPlan.days[0].editDisabledReason, /초안과 실제 업무차수 불일치/);
for (const value of ['', ' ', null, undefined]) assert.equal(validate(value).state, 'UNCHANGED');
for (const value of [0, '0', '0.0', '2.5', '.5', '1e2']) assert.equal(validate(value).state, 'VALID');
for (const value of [-1, '-2', NaN, Infinity, 'NaN', 'abc', '0x10', '2단', '1e999', false]) assert.equal(validate(value).state, 'INVALID');
assert.throws(() => edit(legacyRow, legacyBlock, legacyBlock.days[0], -1), /0 이상의/);

const options = { cycle: cycles[1], dates: ['2026-09-17'], onPrint: () => {}, customerProvided: true };
assert.equal(printReason(options), '');
assert.equal(printReason({ ...options, mode: 'major', dates: [] }), '');
assert.match(printReason({ ...options, customerProvided: false }), /거래처/);
assert.match(printReason({ ...options, onPrint: undefined }), /미연결/);
assert.match(printReason({ ...options, printBusy: true }), /처리 중/);
assert.match(printReason({ ...options, dates: [] }), /요일/);
assert.match(printReason({ ...options, dates: ['2025-09-17'] }), /요일/);
assert.match(printReason({ ...options, cycle: { ...cycles[1], calendarState: 'MISSING_CYCLE' } }), /달력/);
const missingCalendar = { ...cycles[1], days: cycles[1].days.map((day, index) => index === 0 ? { ...day, calendarState: 'MISSING' } : day) };
assert.match(printReason({ ...options, cycle: missingCalendar }), /요일/);
assert.match(printReason({ ...options, cycle: missingCalendar, mode: 'major' }), /7일/);
assert.equal(printReason({ ...options, cycle: missingCalendar, dates: ['2026-09-18'] }), '', 'other verified days remain printable');
const yearBoundary = { ...cycles[1], year: 2026, majorWeek: '53', days: cycles[1].days.map((day) => ({ ...day, date: '2027-01-04', orderWeek: '53-02' })) };
const boundaryRow = build([yearBoundary], [plan({ orderWeek: '53-02', date: '2027-01-04' })], [actual({ year: 2027, orderWeek: '53-02' })]).rows[0];
assert.equal(edit(boundaryRow, boundaryRow.blocks[0], boundaryRow.blocks[0].days[0], 0).year, 2026, 'date calendar year must not replace ERP business year');

// Parse JSX and server-render the actual component, without a build/server/DB connection.
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
// Require the already-installed native compiler directly: never trigger SWC download fallback.
const targetSuffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${targetSuffix}`);
const source = readFileSync(new URL('../components/WeekdayCycleMatrix.js', import.meta.url), 'utf8');
const compiled = transformSync(source + '\nexport { QuantityCell };', false, Buffer.from(JSON.stringify({ filename: 'WeekdayCycleMatrix.js',
  jsc: { target: 'es2020', parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } })));
const mod = { exports: {} };
const componentRequire = createRequire(fileURLToPath(new URL('../components/WeekdayCycleMatrix.js', import.meta.url)));
new Function('require', 'module', 'exports', compiled.code)((name) => name.includes('weekdayHorizontalMatrix') ? helper : componentRequire(name), mod, mod.exports);
const Component = mod.exports.default;
const html = renderToStaticMarkup(React.createElement(Component, {
  cycles, plans: [plan()], comparisonRows: [actual(), actual({ orderWeek: '38-02', state: 'NO_SHIPMENT', shipmentOutQuantity: null, shipmentDates: [] })],
  onEditCell: () => {}, onPrint: () => {}, customer: { CustKey: 7 },
}));
assert.equal((html.match(/<table>/g) || []).length, 1);
assert.equal((html.match(/wcm-day-print/g) || []).length, 22, '21 day buttons plus CSS selector');
assert.equal((html.match(/type="checkbox"/g) || []).length, 21);
assert.equal((html.match(/미적용 초안 수량"/g) || []).length, 21);
assert.equal((html.match(/rowspan="3"/g) || []).length, 1);
assert.equal((html.match(/colspan="8"/gi) || []).length, 3);
assert.match(html, /38차 목 견적 출력/);
assert.match(html, /FlowerName|CARNATION/);
assert.match(html, /min-width:1780px/);
assert.match(html, /thead th \{ position:static; top:auto;/);
assert.match(html, /tbody th \{ position:sticky; top:auto; left:0;/);
assert.match(html, /aria-label="38차 목 견적 출력"[^>]*>출력<\/button>/);
assert.doesNotMatch(html, /wcm-panel|wcm-cycle-links|wcm-heading|max-height/);
assert.match(html, /잔량 미확인/);
const disconnected = renderToStaticMarkup(React.createElement(Component, { cycles, comparisonRows: [actual()] }));
assert.match(disconnected, /출력 불가/);
assert.match(disconnected, /거래처를 먼저 선택/);
assert.match(disconnected, /초안 편집 기능 미연결/);

// Execute the real event handlers with a minimal deterministic hook host.
// No browser/network or test-only edits to the component are required.
let activeHost = null;
const testReact = { ...React,
  useState(initial) {
    const host = activeHost; const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [host.slots[index], (update) => { host.slots[index] = typeof update === 'function' ? update(host.slots[index]) : update; }];
  },
  useRef(initial) {
    const host = activeHost; const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = { current: initial };
    return host.slots[index];
  },
  useMemo(factory) { return factory(); },
};
const eventModule = { exports: {} };
new Function('require', 'module', 'exports', compiled.code)((name) => name === 'react' ? testReact
  : name.includes('weekdayHorizontalMatrix') ? helper : componentRequire(name), eventModule, eventModule.exports);
const mount = (fn, props) => {
  const host = { index: 0, slots: [], props };
  return { render() { activeHost = host; host.index = 0; try { return fn(host.props); } finally { activeHost = null; } } };
};
const descendants = (element) => !element || typeof element !== 'object' ? []
  : [element, ...React.Children.toArray(element.props?.children).flatMap(descendants)];
let edits = [];
const cellHost = mount(eventModule.exports.QuantityCell, { row: legacyRow, block: legacyBlock,
  day: legacyBlock.days[0], disabled: false, onSelect: () => {}, onEditCell: (payload) => { edits.push(payload); } });
const inputFor = (host) => descendants(host.render()).find((element) => element.type === 'input');
inputFor(cellHost).props.onChange({ target: { value: '0' } });
await inputFor(cellHost).props.onBlur();
assert.equal(edits.length, 1);
assert.equal(edits[0].quantity, 0);
assert.equal(edits[0].orderWeek, '38-02');
await inputFor(cellHost).props.onBlur();
assert.equal(edits.length, 1, 'blur without a new edit is idempotent');
inputFor(cellHost).props.onChange({ target: { value: '' } });
await inputFor(cellHost).props.onBlur();
assert.equal(edits.length, 1, 'empty input does not stage a change');
inputFor(cellHost).props.onChange({ target: { value: '-1' } });
await inputFor(cellHost).props.onBlur();
assert.equal(inputFor(cellHost).props['aria-invalid'], true);
assert.equal(edits.length, 1);
assert.ok(descendants(cellHost.render()).some((element) => element.props?.role === 'alert'));
inputFor(cellHost).props.onChange({ target: { value: '9' } });
let enterCommit;
inputFor(cellHost).props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {},
  currentTarget: { blur() { enterCommit = inputFor(cellHost).props.onBlur(); } } });
await enterCommit;
assert.equal(edits.length, 2);
assert.equal(edits[1].quantity, 9);
const blockedHost = mount(eventModule.exports.QuantityCell, { row: legacyRow, block: ambiguous,
  day: ambiguous.days[0], disabled: false, onSelect: () => {}, onEditCell: () => { throw new Error('must not run'); } });
assert.equal(inputFor(blockedHost).props.disabled, true);
inputFor(blockedHost).props.onChange({ target: { value: '3' } });
await inputFor(blockedHost).props.onBlur();
const rejectedHost = mount(eventModule.exports.QuantityCell, { row: legacyRow, block: legacyBlock,
  day: legacyBlock.days[0], disabled: false, onSelect: () => {}, onEditCell: () => ({ success: false, error: 'fixture failure' }) });
inputFor(rejectedHost).props.onChange({ target: { value: '12' } });
await inputFor(rejectedHost).props.onBlur();
assert.equal(inputFor(rejectedHost).props.value, '12', 'failed edit retains user input');
assert.ok(descendants(rejectedHost.render()).some((element) => element.props?.role === 'alert'));

const printRequests = [];
const mainHost = mount(eventModule.exports.default, { cycles, plans: [plan()], comparisonRows: [actual()],
  customer: { CustKey: 7 }, onEditCell() {}, onPrint(payload) { printRequests.push(payload); } });
const printButton = (label) => descendants(mainHost.render()).find((element) => element.props?.label === label);
await printButton('38차 목 견적 출력').props.onClick();
assert.deepEqual(printRequests[0], { cycle: cycles[1], dates: ['2026-09-17'], mode: 'dates' });
assert.deepEqual(Object.keys(printRequests[0]).sort(), ['cycle', 'dates', 'mode'], 'drafts are never supplied to printer');
const checkboxes = descendants(mainHost.render()).filter((element) => element.type === 'input' && element.props.type === 'checkbox');
checkboxes[7].props.onChange({ target: { checked: true } });
checkboxes[9].props.onChange({ target: { checked: true } });
await descendants(mainHost.render()).find((element) => element.props?.label === '선택요일 출력 (2)').props.onClick();
assert.deepEqual(printRequests[1].dates, ['2026-09-17', '2026-09-19']);
assert.equal(printRequests[1].mode, 'dates');
await printButton('전체 견적').props.onClick();
assert.equal(printRequests[2].mode, 'major');
assert.deepEqual(printRequests[2].dates, []);
descendants(mainHost.render()).find((element) => element.type === 'input' && element.props.type === 'search')
  .props.onChange({ target: { value: 'no-match-fixture' } });
assert.ok(descendants(mainHost.render()).some((element) => element.type === 'td' && element.props.colSpan === 25));
console.log('Horizontal weekday matrix: union/24-column ordering, year identity, outside rows, safe dated quantities, unit/duplicate guards, zero validation, print eligibility, JSX SSR and edit/print/search event handlers passed.');
