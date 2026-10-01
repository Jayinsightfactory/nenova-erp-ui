import assert from 'node:assert/strict';
import { buildHorizontalWeekdayMatrix, resolveWeekdayPackaging, weekdayQuantityLabel } from '../lib/weekdayHorizontalMatrix.js';
import { SHIPPING_DAYS, shiftDate } from '../lib/weekdayEstimateCycle.js';

const carnation = { bunchOf1Box: 15, steamOf1Bunch: 20, steamOf1Box: 300 };
const alstroPackaging = { bunchOf1Box: 16, steamOf1Bunch: 10, steamOf1Box: 160 };
const boxLabel = (value, packaging = carnation) => weekdayQuantityLabel(value, {}, '박스', packaging);
const stemsLabel = (value, packaging = carnation) => weekdayQuantityLabel(value, {}, '송이', packaging);

assert.equal(boxLabel(1.2), '1박스 3단');
assert.equal(boxLabel(0.21), '3단 3송이');
const nearMiss = boxLabel(0.20000001);
assert.match(nearMiss, /환산 확인/);
assert.doesNotMatch(nearMiss, /3단/, 'a non-integral 3.00000015 bunch result must not be rounded into 3단');
assert.equal(boxLabel(0.26666666666666666), '4단', 'floating representation noise around an exact integer count is tolerated');
assert.equal(boxLabel(-0.21), '-3단 3송이', 'negative quantities decompose by absolute amount and apply one sign');
assert.equal(boxLabel(0.21, { steamOf1Box: 300 }), '63송이', 'stem-only packaging can convert without bunch metadata');
assert.equal(weekdayQuantityLabel(1.25, {}, '단', carnation), '1단 5송이', 'fractional bunches use stems per bunch');
assert.equal(stemsLabel(13), '13');
assert.equal(weekdayQuantityLabel(1.2, {}, '단', { steamOf1Bunch: 20 }), '1단 4송이');
assert.equal(boxLabel(0.21, { bunchOf1Box: 15, steamOf1Bunch: 20, steamOf1Box: 0 }), '0.21박스 · 환산 확인',
  'explicitly invalid packaging metadata blocks an otherwise derivable conversion');
assert.equal(boxLabel(0.21, { bunchOf1Box: 15, steamOf1Bunch: 20, steamOf1Box: null }), '3단 3송이',
  'missing box-stem count may be derived from valid bunch counts for display only');

assert.equal(boxLabel(0), '0', 'integer zero remains its original integer display');
assert.equal(boxLabel(-1), '-1', 'integer negative remains its original integer display');
assert.equal(boxLabel(0, { bunchOf1Box: 0, steamOf1Bunch: 20, steamOf1Box: 300 }), '0',
  'bad packaging metadata does not change an already-integer raw display');
assert.equal(boxLabel(-1, { bunchOf1Box: -15, steamOf1Bunch: 20, steamOf1Box: 300 }), '-1');
assert.equal(weekdayQuantityLabel(null, {}, '박스', carnation), '—');
assert.equal(weekdayQuantityLabel(undefined, {}, '박스', carnation), '—');
assert.equal(weekdayQuantityLabel('', {}, '박스', carnation), '—');
assert.equal(weekdayQuantityLabel('not-a-number', {}, '박스', carnation), '—');
for (const invalid of [
  { bunchOf1Box: 0, steamOf1Bunch: 0, steamOf1Box: 0 },
  { bunchOf1Box: -15, steamOf1Bunch: -20, steamOf1Box: -300 },
  { bunchOf1Box: 15.5, steamOf1Bunch: 20.5, steamOf1Box: 300.5 },
  { bunchOf1Box: null, steamOf1Bunch: null, steamOf1Box: null },
]) {
  assert.match(boxLabel(1.2, invalid), /1\.2박스 · 환산 확인/, `invalid packaging must preserve source quantity: ${JSON.stringify(invalid)}`);
}
assert.equal(boxLabel(1.2, { ...carnation, steamOf1Box: 301 }), '1.2박스 · 환산 확인', 'internally conflicting package counts are not used');
const tiny = boxLabel(0.00000001);
assert.notEqual(tiny, '0');
assert.notEqual(tiny, '');
assert.match(tiny, /(?:0\.00000001|1e-8)/);
assert.match(tiny, /환산 확인/);
const tinyUnknown = weekdayQuantityLabel(0.00000001, {}, '박스', null);
assert.match(tinyUnknown, /(?:0\.00000001|1e-8)박스 · 환산 확인/,
  'a tiny positive value without packaging metadata retains a nonzero raw label');

assert.equal(weekdayQuantityLabel(48, { flowerNames: ['알스트로'] }, '단', alstroPackaging), '48(3)');
assert.equal(weekdayQuantityLabel(50, { flowerNames: ['알스트로'] }, '단', alstroPackaging), '50(3박스 2단)');
assert.equal(weekdayQuantityLabel(-50, { flowerNames: ['알스트로'] }, '단', alstroPackaging), '-50(-3박스 2단)');

const cycle = { offset: 0, year: 2026, majorWeek: '38', calendarState: 'FOUND', days: SHIPPING_DAYS.map((day, index) => ({
  ...day, date: shiftDate('2026-09-17', index), orderWeek: `38-${day.suffix}`, calendarState: 'FOUND',
})) };
const cycle39 = { ...cycle, offset: 1, majorWeek: '39', days: SHIPPING_DAYS.map((day, index) => ({
  ...day, date: shiftDate('2026-09-24', index), orderWeek: `39-${day.suffix}`,
})) };
const actual = (patch = {}) => ({ year: 2026, orderWeek: '38-01', prodKey: 41, prodName: 'Carnation',
  flowerName: '카네이션', outUnit: '박스', shipmentOutQuantity: 1.2, shipmentDates: [],
  packaging: carnation, ...patch });
assert.deepEqual(resolveWeekdayPackaging([actual()]).bunchOf1Box, 15);
assert.equal(resolveWeekdayPackaging([]), null);
assert.equal(resolveWeekdayPackaging([actual(), actual({ packaging: { ...carnation, bunchOf1Box: 16, steamOf1Box: 320 } })]), null,
  'conflicting metadata among scoped actual rows is rejected');

const cases = [
  {
    name: 'scoped current-year/current-major product reads provide display packaging',
    comparisons: [actual()],
    expected: carnation,
  },
  {
    name: 'prior-year same-week product metadata cannot leak into the selected year',
    comparisons: [actual({ year: 2025, packaging: alstroPackaging })],
    expected: null,
  },
  {
    name: 'another major week product metadata cannot leak into this block',
    comparisons: [actual({ orderWeek: '39-01', packaging: alstroPackaging })],
    expected: null,
  },
  {
    name: 'other-major metadata stays on its own block',
    comparisons: [actual(), actual({ orderWeek: '39-01', packaging: alstroPackaging })],
    expected: carnation,
    otherMajorExpected: alstroPackaging,
  },
  {
    name: 'a conflicting scoped product read disables conversion instead of selecting one',
    comparisons: [actual(), actual({ orderWeek: '38-02', packaging: { ...carnation, steamOf1Box: 301 } })],
    expected: null,
  },
];
for (const item of cases) {
  const comparisons = item.comparisons.map(row => ({ ...row,
    shipmentDates: [{ date: row.orderWeek.startsWith('39') ? '2026-09-24' : '2026-09-17', shipmentQuantity: 1 }],
  }));
  const before = JSON.stringify(comparisons);
  const matrix = buildHorizontalWeekdayMatrix([cycle, cycle39], [], comparisons);
  const row = matrix.rows.find(candidate => candidate.prodKey === 41);
  if (item.expected === null && item.name.includes('prior-year')) {
    assert.equal(row, undefined, item.name);
    assert.equal(JSON.stringify(comparisons), before, 'display packaging resolution never mutates API rows');
    continue;
  }
  assert.deepEqual(row.blocks.find(block => block.cycle.majorWeek === '38').packaging, item.expected, item.name);
  if (item.otherMajorExpected) {
    assert.deepEqual(row.blocks.find(block => block.cycle.majorWeek === '39').packaging, item.otherMajorExpected);
  }
  assert.equal(JSON.stringify(comparisons), before, 'display packaging resolution never mutates API rows');
}

const sourceRow = actual({ packaging: { ...carnation } });
const before = JSON.stringify(sourceRow);
weekdayQuantityLabel(sourceRow.shipmentOutQuantity, sourceRow, sourceRow.outUnit, sourceRow.packaging);
assert.equal(JSON.stringify(sourceRow), before, 'formatting does not mutate the row, packaging, or input quantity');
assert.ok(Object.isFrozen(Object.freeze({ ...sourceRow })), 'fixture source can be frozen without formatter writes');

console.log('Weekday quantity units: exact box/bunch/stem display, invalid/zero/tiny guards, Alstro 48/50 labels, packaging scope/conflict, and input immutability passed');
