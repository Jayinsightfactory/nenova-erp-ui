import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as helper from '../lib/weekdayHorizontalMatrix.js';
import { SHIPPING_DAYS, shiftDate } from '../lib/weekdayEstimateCycle.js';

const { buildHorizontalWeekdayMatrix: build, horizontalEditPayload: edit,
  horizontalPrintReason: printReason, validateHorizontalQuantity: validate,
  hasHorizontalShipmentQuantity: hasShipment } = helper;
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
assert.equal(matrix.columns.length, 33);
assert.deepEqual(matrix.columns.map((column) => column.kind), Array.from({ length: 3 }, () => ['initial01',...Array(4).fill('day'),'remaining01','initial02',...Array(3).fill('day'),'remainingMajor']).flat());
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

// Eligibility filters the UI only; the raw matrix must retain every in-scope row/source.
const noShipmentActual = (patch = {}) => actual({ state: 'NO_SHIPMENT', shipmentOutQuantity: null,
  shipmentDates: [], orderOutQuantity: 800, orderEstQuantity: 900, warehouseQuantity: 700, ...patch });
const eligibilityCases = [
  { name: 'order-only', comparisons: [noShipmentActual()], visible: false },
  { name: 'estimate-only', comparisons: [noShipmentActual({ shipmentDates: [
    { date: '2026-09-17', shipmentQuantity: 0, estimateQuantity: 999 },
  ] })], visible: false },
  { name: 'positive-fraction-total', comparisons: [noShipmentActual({ shipmentOutQuantity: 0.125 })], visible: true },
  { name: 'positive-date-total-null', comparisons: [noShipmentActual({ shipmentDates: [
    { date: '2026-09-17', shipmentQuantity: 0.25 },
  ] })], visible: true },
  ...['37', '39'].map((week) => ({ name: `adjacent-${week}`, comparisons: [noShipmentActual({
    orderWeek: `${week}-01`, shipmentOutQuantity: 0.5,
  })], visible: true })),
  { name: 'outside-date-positive', comparisons: [noShipmentActual({ shipmentDates: [
    { date: '2026-10-01', shipmentQuantity: 0.5 },
  ] })], visible: true },
  { name: 'ambiguous-business-keys', comparisons: [
    noShipmentActual({ shipmentDates: [{ date: '2026-09-17', shipmentQuantity: 0.5 }] }),
    noShipmentActual({ orderWeek: '38-02', shipmentDates: [{ date: '2026-09-17', shipmentQuantity: -0.5 }] }),
  ], visible: true, aggregateUnknown: true },
  { name: 'mixed-units', comparisons: [noShipmentActual({ shipmentOutQuantity: 0.5, shipmentDates: [
    { date: '2026-09-17', shipmentQuantity: 0.5 },
  ] }), noShipmentActual({ outUnit: '단', shipmentOutQuantity: -0.5, shipmentDates: [
    { date: '2026-09-17', shipmentQuantity: -0.5 },
  ] })], visible: true, aggregateUnknown: true },
  { name: 'prior-year-same-week', comparisons: [noShipmentActual(), actual({ year: 2025,
    orderWeek: '38-02', shipmentOutQuantity: 999, shipmentDates: [{ date: '2026-09-17', shipmentQuantity: 999 }] })], visible: false },
  { name: 'positive-draft', plans: [plan({ quantity: 0.125 })], comparisons: [], visible: true },
  { name: 'zero-only-draft', plans: [plan({ quantity: 0 })], comparisons: [], visible: false },
  { name: 'duplicate-mixed-unit-drafts', plans: [plan({ quantity: 0.5 }),
    plan({ id: 'F4', unit: '단', quantity: 0 })], comparisons: [], visible: true },
];
for (const [index, value] of [0, '0', -1, '-0.5', null, undefined, '', ' ', 'invalid', NaN, Infinity,
  -Infinity, 'NaN', 'Infinity', '1e999', false].entries()) {
  eligibilityCases.push({ name: `nonpositive-or-invalid-${index}`, comparisons: [noShipmentActual({
    shipmentOutQuantity: value, shipmentDates: [{ date: '2026-09-17', shipmentQuantity: value }],
  })], plans: [plan({ quantity: value })], visible: false });
}
for (const fixture of eligibilityCases) {
  const plans = fixture.plans || [];
  const snapshot = structuredClone({ plans, comparisons: fixture.comparisons });
  const raw = build(cycles, plans, fixture.comparisons);
  assert.equal(raw.rows.length, 1, `${fixture.name}: retain raw product even when hidden`);
  assert.equal(raw.rows[0].blocks.flatMap((block) => block.productActuals).length,
    fixture.comparisons.filter((item) => item.year === 2026).length, `${fixture.name}: preserve scoped actuals`);
  assert.equal(raw.rows[0].blocks.flatMap((block) => block.productPlans).length, plans.length,
    `${fixture.name}: preserve drafts`);
  assert.equal(hasShipment(raw.rows[0]), fixture.visible, fixture.name);
  assert.deepEqual({ plans, comparisons: fixture.comparisons }, snapshot, `${fixture.name}: never mutate inputs`);
  if (fixture.aggregateUnknown) assert.equal(raw.rows[0].blocks[1].days[0].current, null,
    `${fixture.name}: raw positive eligibility must not depend on aggregate`);
}
assert.equal(hasShipment(null), false);
assert.equal(hasShipment({ blocks: [] }), false);
assert.equal(hasShipment({ blocks: [{ currentTotal: 99, plannedTotal: 99, days: [{ current: 99 }] }] }), false,
  'computed quantities are not raw shipment evidence');
assert.equal(build(cycles, [], [actual({ year: 2025, orderWeek: '38-02' })]).rows.length, 0,
  'prior-year-only product never enters the displayed year');
assert.deepEqual(prioritized.rows.filter(hasShipment).map((row) => row.prodKey), [504, 505, 502]);
assert.equal(prioritized.rows.length, 5, 'display eligibility never removes raw matrix rows');
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
assert.equal((html.match(/colspan="11"/gi) || []).length, 3);
assert.match(html, /38차 목 견적 출력/);
assert.match(html, /FlowerName|CARNATION/);
assert.match(html, /min-width:3032px/);
assert.match(html, /tbody tr:is\(:hover,:focus-within\)/);
assert.match(html, /font-size:13px/);
assert.match(html, /thead th \{ position:static; top:auto;/);
assert.match(html, /tbody th \{ position:sticky; top:auto; left:0;/);
assert.match(html, /aria-label="38차 목 견적 출력"[^>]*>출력<\/button>/);
assert.doesNotMatch(html, /wcm-panel|wcm-cycle-links|wcm-heading|max-height/);
assert.match(html, /잔량 미확인/);
const disconnected = renderToStaticMarkup(React.createElement(Component, { cycles, comparisonRows: [actual()] }));
assert.match(disconnected, /출력 불가/);
assert.match(disconnected, /거래처를 먼저 선택/);
assert.match(disconnected, /초안 편집 기능 미연결/);

const renderMatrix = (props) => renderToStaticMarkup(React.createElement(Component, { cycles, ...props }));
const tableBody = (markup) => markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
const hiddenComparisons = [
  noShipmentActual({ prodKey: 701, prodName: 'ORDER_ONLY_HIDDEN', flowerName: 'HIDDEN_FLOWER' }),
  noShipmentActual({ prodKey: 702, prodName: 'ZERO_SHIPMENT_HIDDEN', shipmentOutQuantity: 0,
    shipmentDates: [{ date: '2026-09-17', shipmentQuantity: 0 }] }),
];
const visibilityHtml = renderMatrix({ comparisonRows: [...hiddenComparisons, actual()] });
assert.match(tableBody(visibilityHtml), /wcm-product-name">Blue<\/span>/);
assert.doesNotMatch(visibilityHtml, /ORDER_ONLY_HIDDEN|ZERO_SHIPMENT_HIDDEN|HIDDEN_FLOWER/);
assert.equal((tableBody(visibilityHtml).match(/<tr>/g) || []).length, 1);
assert.match(visibilityHtml, /품목 1\/1 · 출고 없음 2개 숨김/);
const allHiddenHtml = renderMatrix({ comparisonRows: hiddenComparisons });
assert.match(allHiddenHtml, /품목 0\/0 · 출고 없음 2개 숨김/);
assert.match(tableBody(allHiddenHtml), /표시 범위에 출고 수량 또는 양수 초안이 있는 품목이 없습니다\. 출고 없는 품목은 숨겼습니다\./);
assert.doesNotMatch(allHiddenHtml, /ORDER_ONLY_HIDDEN|ZERO_SHIPMENT_HIDDEN/);
assert.match(tableBody(renderMatrix({})), /조회된 품목 또는 초안이 없습니다\. 재고 0을 의미하지 않습니다\./);
for (const fixture of eligibilityCases) {
  const markup = renderMatrix({ plans: fixture.plans || [], comparisonRows: fixture.comparisons });
  assert.equal(tableBody(markup).includes('wcm-product-name'), fixture.visible, `${fixture.name}: actual component SSR visibility`);
  assert.match(markup, fixture.visible ? /품목 1\/1 · 출고 없음 0개 숨김/ : /품목 0\/0 · 출고 없음 1개 숨김/);
}

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
assert.ok(descendants(mainHost.render()).some((element) => element.type === 'td' && element.props.colSpan === 34));
assert.ok(descendants(mainHost.render()).some((element) => element.type === 'td'
  && element.props.children === '검색/품종 조건에 맞는 품목이 없습니다.'));
const filterHost = mount(eventModule.exports.default, { cycles, comparisonRows: [...hiddenComparisons, actual()] });
const filterElements = () => descendants(filterHost.render());
assert.ok(!filterElements().some((element) => element.type === 'option' && element.props.value === 'HIDDEN_FLOWER'));
filterElements().find((element) => element.type === 'input' && element.props.type === 'search')
  .props.onChange({ target: { value: 'ORDER_ONLY_HIDDEN' } });
assert.ok(filterElements().some((element) => element.type === 'td'
  && element.props.children === '검색/품종 조건에 맞는 품목이 없습니다.'));
assert.ok(filterElements().some((element) => element.type === 'span'
  && React.Children.toArray(element.props.children).join('').includes('품목 0/1 · 출고 없음 2개 숨김')));
filterElements().find((element) => element.type === 'input' && element.props.type === 'search')
  .props.onChange({ target: { value: '' } });
filterElements().find((element) => element.type === 'select')
  .props.onChange({ target: { value: 'CARNATION' } });
assert.equal(filterElements().filter((element) => element.props?.className === 'wcm-product-name').length, 1);

// Execute the actual async picker handlers: no fake order/draft or ERP write for explicit display additions.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const candidate = { ProdKey: 702, ProdName: 'ZERO_SHIPMENT_HIDDEN', FlowerName: 'CARNATION' };
const searchedQueries = [], addedProducts = [];
let searchOutcome = deferred(), addOutcome = deferred();
const pickerProps = { cycles, customer: { CustKey: 7 }, comparisonRows: [...hiddenComparisons, actual()],
  onSearchProducts(query) { searchedQueries.push(query); return searchOutcome.promise; },
  onAddProduct(product) { addedProducts.push(product); return addOutcome.promise; } };
const pickerSnapshot = structuredClone(pickerProps.comparisonRows);
const pickerHost = mount(eventModule.exports.default, pickerProps);
const pickerElements = () => descendants(pickerHost.render());
const pickerRegion = () => pickerElements().find((element) => element.props?.['aria-label'] === '품목 추가 검색');
const pickerButton = (label) => descendants(pickerRegion()).find((element) => element.type === 'button'
  && React.Children.toArray(element.props.children)[0] === label);
const addedRowNames = () => pickerElements().filter((element) => element.type === 'th' && element.props?.scope === 'row')
  .map((element) => element.props.title.split('\n')[0]);
const pickerAlert = (message) => descendants(pickerRegion()).some((element) => element.props?.role === 'alert'
  && element.props.children === message);
const typeAddQuery = (value) => descendants(pickerRegion()).find((element) => element.type === 'input')
  .props.onChange({ target: { value } });
const openPicker = () => pickerElements().find((element) => element.type === 'button'
  && element.props.children === '품목 추가');
assert.equal(openPicker().props.disabled, false);
openPicker().props.onClick();
assert.ok(pickerButton('ORDER_ONLY_HIDDEN'), 'opening offers hidden rows without invoking search');
assert.ok(pickerButton(candidate.ProdName));
assert.deepEqual(searchedQueries, []);
assert.deepEqual(addedRowNames(), ['CARNATION Blue']);
typeAddQuery('  zero product  ');
const failedSearch = pickerButton('검색').props.onClick();
assert.equal(pickerButton('검색').props.disabled, true);
assert.equal(pickerButton('닫기').props.disabled, true);
assert.equal(pickerButton(candidate.ProdName).props.disabled, true);
assert.equal(descendants(pickerRegion()).find((element) => element.type === 'input').props.disabled, true);
searchOutcome.reject(new Error('fixture search failure'));
await failedSearch;
assert.deepEqual(searchedQueries, ['zero product']);
assert.ok(pickerAlert('fixture search failure'));
assert.equal(pickerButton('검색').props.disabled, false);
searchOutcome = deferred();
const emptySearch = pickerButton('검색').props.onClick();
searchOutcome.resolve([]); await emptySearch;
assert.ok(pickerAlert('검색된 품목이 없습니다.'));
searchOutcome = deferred();
const successfulSearch = pickerButton('검색').props.onClick();
searchOutcome.resolve([candidate]); await successfulSearch;
assert.equal(pickerButton(candidate.ProdName).props.disabled, false);
assert.ok(!descendants(pickerRegion()).some((element) => element.props?.role === 'alert'));
const candidateHandler = pickerButton(candidate.ProdName).props.onClick;
const failedAdd = candidateHandler();
await candidateHandler();
assert.equal(addedProducts.length, 1, 'pending add lock prevents duplicate callback');
assert.equal(pickerButton(candidate.ProdName).props.disabled, true);
assert.deepEqual(addedRowNames(), ['CARNATION Blue'], 'pending add does not reveal zero row');
addOutcome.resolve({ success: false, error: 'fixture add failure' }); await failedAdd;
assert.ok(pickerAlert('fixture add failure'));
assert.deepEqual(addedRowNames(), ['CARNATION Blue'], 'failed add leaves zero row hidden');
assert.equal(pickerButton(candidate.ProdName).props.disabled, false);
addOutcome = deferred();
const rejectedAdd = pickerButton(candidate.ProdName).props.onClick();
addOutcome.reject(new Error('fixture add rejected')); await rejectedAdd;
assert.ok(pickerAlert('fixture add rejected'));
assert.deepEqual(addedRowNames(), ['CARNATION Blue']);
// A successful explicit addition clears existing display filters, retaining the actual zero source.
pickerElements().find((element) => element.type === 'input' && element.props.type === 'search')
  .props.onChange({ target: { value: 'no-match-fixture' } });
pickerElements().find((element) => element.type === 'select').props.onChange({ target: { value: 'HIDDEN_FLOWER' } });
addOutcome = deferred();
const successfulAdd = pickerButton(candidate.ProdName).props.onClick();
addOutcome.resolve(true); await successfulAdd;
assert.equal(pickerRegion(), undefined);
assert.deepEqual(addedProducts, [candidate, candidate, candidate]);
assert.deepEqual(addedRowNames(), ['ZERO_SHIPMENT_HIDDEN', 'CARNATION Blue']);
assert.ok(pickerElements().some((element) => element.type === 'span'
  && React.Children.toArray(element.props.children).join('').includes('품목 2/2 · 출고 없음 1개 숨김')));
const zeroCell = pickerElements().find((element) => element.props?.row?.prodKey === 702
  && element.props?.day?.date === '2026-09-17');
assert.equal(zeroCell.props.day.current, 0);
assert.equal(zeroCell.props.block.currentTotal, 0);
assert.equal(zeroCell.props.day.planned, null, 'explicit display addition creates no draft');
assert.equal(hasShipment(rowFor([], [hiddenComparisons[1]])), false, 'manual addition does not change pure shipment eligibility');
assert.deepEqual(pickerProps.comparisonRows, pickerSnapshot, 'picker leaves ERP fixture sources untouched');
assert.equal(addedRowNames().filter((name) => name === candidate.ProdName).length, 1, 'zero row stays on rerender exactly once');
openPicker().props.onClick();
assert.equal(pickerButton(candidate.ProdName), undefined, 'added product is no longer offered as hidden');
pickerButton('닫기').props.onClick();
assert.equal(pickerRegion(), undefined);
const missingCustomerHost = mount(eventModule.exports.default, { cycles, onAddProduct() {} });
assert.equal(descendants(missingCustomerHost.render()).find((element) => element.type === 'button'
  && element.props.children === '품목 추가').props.disabled, true);
console.log(`Horizontal weekday matrix: ${eligibilityCases.length} raw-shipment eligibility and real SSR fixtures, raw row preservation, hidden count/empty/filter states, async product picker pending/failure/success/zero-row retention, union/33-column ordering, year identity, outside rows, unit/duplicate guards, zero validation, print eligibility and edit/print/search event handlers passed.`);
