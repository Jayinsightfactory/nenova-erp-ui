import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeekdayCarryoverLedger, applyWeekdayCarryoverToMatrix } from '../lib/weekdayCarryover.js';
import { buildHorizontalWeekdayMatrix, horizontalEditPayload } from '../lib/weekdayHorizontalMatrix.js';
import { SHIPPING_DAYS, shiftDate } from '../lib/weekdayEstimateCycle.js';

const cycles = [
  { year: 2026, majorWeek: '37', startDate: '2026-09-10', calendarState: 'FOUND' },
  { year: 2026, majorWeek: '38', startDate: '2026-09-17', calendarState: 'FOUND' },
  { year: 2026, majorWeek: '39', startDate: '2026-09-24', calendarState: 'FOUND' },
];
const context = { custKey: 533, cycles, inputs: [
  { year: 2026, majorWeek: '37', prodKey: 866, custKey: 533, unit: '박스', basis: 12, allocated: 12, valid: true },
  { year: 2026, majorWeek: '38', prodKey: 866, custKey: 533, unit: '박스', basis: 10, allocated: 8, valid: true },
  { year: 2026, majorWeek: '39', prodKey: 866, custKey: 533, unit: '박스', basis: 4, allocated: 3, valid: true },
] };
const record = (changes = {}) => ({ year: 2026, majorWeek: '37', custKey: 533, prodKey: 866,
  unit: '박스', quantity: 5, startDate: '2026-09-10', revision: 1, history: [], ...changes });
const key = (year, week, prodKey = 866) => `${year}|${week}|${prodKey}`;

test('manual 37 closing carries through 38 and 39 without changing basis/out totals', () => {
  const ledger = buildWeekdayCarryoverLedger(context, [record()]);
  assert.equal(ledger.get(key(2026, '37')).closing, 5);
  assert.equal(ledger.get(key(2026, '38')).incoming, 5);
  assert.equal(ledger.get(key(2026, '38')).baseRemainder, 2);
  assert.equal(ledger.get(key(2026, '38')).closing, 7);
  assert.equal(ledger.get(key(2026, '39')).incoming, 7);
  assert.equal(ledger.get(key(2026, '39')).baseRemainder, 1);
  assert.equal(ledger.get(key(2026, '39')).closing, 8);
  assert.equal(context.inputs[1].basis, 10);
  assert.equal(context.inputs[1].allocated, 8);
});

test('zero and negative manual balances are explicit valid seeds; a later manual close resets the chain', () => {
  const zeroContext = { ...context, inputs: context.inputs.map(row => ({ ...row, prodKey: 867 })) };
  const zero = buildWeekdayCarryoverLedger(zeroContext, [record({ prodKey: 867, quantity: 0 })]);
  assert.equal(zero.get(key(2026, '37', 867)).closing, 0);
  assert.equal(zero.get(key(2026, '38', 867)).closing, 2);
  const negative = buildWeekdayCarryoverLedger(zeroContext, [record({ prodKey: 867, quantity: -2 })]);
  assert.equal(negative.get(key(2026, '38', 867)).closing, 0);
  const reset = buildWeekdayCarryoverLedger(context, [record(), record({ majorWeek: '38', startDate: '2026-09-17', quantity: 0 })]);
  assert.equal(reset.get(key(2026, '38')).closing, 0);
  assert.equal(reset.get(key(2026, '39')).closing, 1);
});

test('customer, year, product, and unit are not mixed; an actual calendar gap blocks propagation', () => {
  const isolated = buildWeekdayCarryoverLedger(context, [
    record(), record({ custKey: 534, quantity: 900 }),
    record({ year: 2025, quantity: 800 }), record({ prodKey: 999, quantity: 700 }),
  ]);
  assert.equal(isolated.get(key(2026, '38')).closing, 7);
  const wrongUnit = buildWeekdayCarryoverLedger({ ...context, inputs: context.inputs.map((row, i) => i === 1 ? { ...row, unit: '단' } : row) }, [record()]);
  assert.equal(wrongUnit.get(key(2026, '38')).closing, null);
  assert.match(wrongUnit.get(key(2026, '38')).error, /단위/);
  const gap = buildWeekdayCarryoverLedger({ ...context, cycles: [cycles[0], { ...cycles[1], startDate: '2026-09-18' }, cycles[2]] }, [record()]);
  assert.equal(gap.get(key(2026, '38')).closing, null);
  assert.match(gap.get(key(2026, '38')).error, /간격/);
});

test('unknown basis stays null until a valid manual seed, and outside-context records cannot invent products', () => {
  const missing = { ...context, inputs: context.inputs.map((row, i) => i === 1 ? { ...row, basis: null } : row) };
  const ledger = buildWeekdayCarryoverLedger(missing, [record()]);
  assert.equal(ledger.get(key(2026, '38')).closing, null);
  assert.equal(buildWeekdayCarryoverLedger({ ...context, inputs: [] }, [record({ custKey: 534 })]).size, 0);
});

test('visible draft projection recalculates carry only and preserves matrix totals, quote, and initial snapshots', () => {
  const draftMatrix = { rows: [{ prodKey: 866, blocks: cycles.map((cycle, index) => ({ cycle,
    unit: '박스', productActuals: [{ year: cycle.year, orderWeek: `${cycle.majorWeek}-01`, shipmentOutQuantity: index === 1 ? 8 : 3 }],
    productPlans: index === 1 ? [{ quantity: 12 }] : [],
    initial01: { quantity: 4 }, initial02: { quantity: 6 }, initialMajor: 10,
    currentTotal: 8, plannedTotal: index === 1 ? 12 : null, effectiveTotal: index === 1 ? 20 : 8,
    quote: { state: '견적 일치', managementQuantity: 20, amount: 12345 },
    remainderMajorView: { value: index === 1 ? 12 : 1, hasDraft: index === 1 },
    remainder01View: { value: 2 },
  })) }] };
  const before = JSON.stringify(draftMatrix.rows[0].blocks.map(({ currentTotal, plannedTotal, effectiveTotal, quote, initial01, initial02 }) =>
    ({ currentTotal, plannedTotal, effectiveTotal, quote, initial01, initial02 })));
  const projected = applyWeekdayCarryoverToMatrix(draftMatrix, context, [record()]);
  const middle = projected.rows[0].blocks[1];
  assert.equal(middle.carryover.closing, 17, 'draft effective basis 12 plus incoming 5');
  assert.equal(middle.carryover.hasDraft, true);
  assert.equal(middle.remainderMajorView.value, 17);
  assert.equal(JSON.stringify(projected.rows[0].blocks.map(({ currentTotal, plannedTotal, effectiveTotal, quote, initial01, initial02 }) =>
    ({ currentTotal, plannedTotal, effectiveTotal, quote, initial01, initial02 }))), before);
  const scrolled = buildWeekdayCarryoverLedger(context, [record()]);
  assert.equal(scrolled.get(key(2026, '38')).closing, 7, 'same historical context yields same value after visible center changes');
});

test('carry-only input with no baseline/actual uses trusted SELECT zero after a manual seed; invalid server input stays invalid', () => {
  const carryInputs = cycles.map(cycle => ({ year: cycle.year, majorWeek: cycle.majorWeek, prodKey: 912,
    custKey: 533, prodName: 'carry-only fixture', outUnit: '박스', unit: '박스',
    basis: 0, allocated: 0, valid: true, provisional: false, rawOutQuantity: 0 }));
  const carryContext = { custKey: 533, cycles, inputs: carryInputs };
  const skeleton = buildHorizontalWeekdayMatrix(cycles, [], [], [], [], carryInputs);
  assert.equal(skeleton.rows.length, 1, 'sixth carryInputs argument keeps a no-baseline/no-shipment product visible');
  const projected = applyWeekdayCarryoverToMatrix(skeleton, carryContext, [record({ prodKey: 912 })]);
  assert.equal(projected.rows[0].blocks[1].carryover.incoming, 5);
  assert.equal(projected.rows[0].blocks[1].remainderMajorView.value, 5);
  assert.equal(carryInputs[1].rawOutQuantity, 0, 'page-only display never rewrites raw ERP OutQuantity');

  const invalidInputs = carryInputs.map((row, index) => index === 1 ? { ...row, valid: false, error: '서버 출고 기준 불일치' } : row);
  const invalidContext = { ...carryContext, inputs: invalidInputs };
  const invalidProjection = applyWeekdayCarryoverToMatrix(skeleton, invalidContext, [record({ prodKey: 912 })]);
  assert.equal(invalidProjection.rows[0].blocks[1].carryover.closing, null);
  assert.match(invalidProjection.rows[0].blocks[1].carryover.error, /서버 출고 기준 불일치/);

  const draftRow = { prodKey: 912, blocks: cycles.map((cycle, index) => ({ cycle, unit: '박스',
    productActuals: [], productPlans: index === 1 ? [{ quantity: 2 }] : [],
    initial01: null, initial02: null, remainderMajorView: { value: null, hasDraft: index === 1 } })) };
  const blocked = applyWeekdayCarryoverToMatrix({ rows: [draftRow] }, carryContext, [record({ prodKey: 912 })]);
  assert.equal(blocked.rows[0].blocks[1].carryover.closing, null, 'unknown draft remainder is not replaced by the server snapshot');
});

test('hidden-scope drafts invalidate server fallback; visible unit conflict blocks carry calculation', () => {
  const hiddenPlan = { year: 2026, orderWeek: '38-01', custKey: 533, prodKey: 866, quantity: 2, unit: '박스' };
  const visible39 = { rows: [{ prodKey: 866, blocks: [{ cycle: cycles[2], unit: '박스', remainderMajorView: { value: 1 } }] }] };
  const hidden = applyWeekdayCarryoverToMatrix(visible39, context, [record()], [hiddenPlan]);
  const downstream = hidden.rows[0].blocks[0].carryover;
  assert.equal(downstream.closing, null, 'a hidden 38 plan blocks 39 instead of reverting to its trusted old balance');
  assert.equal(downstream.hasDraft, true);
  assert.equal(hidden.rows[0].blocks[0].remainderMajorView.value, null);

  const conflicting = applyWeekdayCarryoverToMatrix({ rows: [{ prodKey: 866, blocks: [
    { cycle: cycles[1], unit: '단', remainderMajorView: { value: 2 } },
  ] }] }, context, [record()]);
  assert.equal(conflicting.rows[0].blocks[0].carryover.closing, null);
  assert.equal(conflicting.rows[0].blocks[0].carryover.error, '초안 또는 전산 수량 단위 충돌');
});

test('visible cycle still blocks fallback when all-scope plans contain a draft hidden by another draftScope', () => {
  const hiddenScopePlan = { id: 'retained-center-38-draft', draftScope: '533|2026|37', year: 2026,
    orderWeek: '38-01', custKey: 533, prodKey: 866, quantity: 2, unit: '박스' };
  const matrix = { rows: [{ prodKey: 866, blocks: [{ cycle: cycles[1], unit: '박스', productPlans: [],
    remainderMajorView: { value: 2, hasDraft: false } }] }] };
  const projected = applyWeekdayCarryoverToMatrix(matrix, context, [record()], [hiddenScopePlan]);
  const block = projected.rows[0].blocks[0];
  assert.equal(block.carryover.closing, null, 'visible server basis cannot silently replace another-scope retained draft');
  assert.equal(block.carryover.hasDraft, true);
  assert.equal(block.carryover.error, '다른 조회 범위에 보관된 초안 확인 필요');
  assert.equal(block.remainderMajorView.value, null);
});

test('a manual close resets inherited provisional/draft flags; incoming flags remain independent', () => {
  const chainCycles = [{ year: 2026, majorWeek: '36', startDate: '2026-09-03', calendarState: 'FOUND' }, ...cycles];
  const chainInputs = [{ year: 2026, majorWeek: '36', prodKey: 866, custKey: 533, unit: '박스', basis: 0, allocated: 0, valid: true },
    ...context.inputs.map((row, index) => index === 0 ? { ...row, provisional: true, hasDraft: false } : row)];
  const chainContext = { custKey: 533, cycles: chainCycles, inputs: chainInputs };
  const reset = buildWeekdayCarryoverLedger(chainContext, [
    record({ majorWeek: '36', startDate: '2026-09-03', quantity: 5 }),
    record({ majorWeek: '38', startDate: '2026-09-17', quantity: 3 }),
  ]);
  const reseed = reset.get(key(2026, '38'));
  assert.equal(reseed.incomingProvisional, true);
  assert.equal(reseed.incomingHasDraft, false);
  assert.equal(reseed.provisional, false);
  assert.equal(reseed.hasDraft, false);
  assert.equal(reset.get(key(2026, '39')).incomingProvisional, false, 'the manual 38 close starts a fresh certainty chain');
  assert.equal(reset.get(key(2026, '39')).incomingHasDraft, false);

  const draftContext = { ...chainContext, inputs: chainInputs.map(row => row.majorWeek === '37'
    ? { ...row, provisional: false, hasDraft: true } : row) };
  const draftOnly = buildWeekdayCarryoverLedger(draftContext, [record({ majorWeek: '36', startDate: '2026-09-03', quantity: 5 })]);
  assert.equal(draftOnly.get(key(2026, '38')).incomingProvisional, false);
  assert.equal(draftOnly.get(key(2026, '38')).incomingHasDraft, true);
});

test('same-day live source plus cross-subweek zero tombstone keeps 01 editable origin and raw zero', () => {
  const cycle = { year: 2026, majorWeek: '38', startDate: '2026-09-17', endDate: '2026-09-23',
    calendarState: 'FOUND', offset: 0, days: SHIPPING_DAYS.map((day, index) => ({ ...day,
      date: shiftDate('2026-09-17', index), orderWeek: `38-${day.suffix}`, calendarState: 'FOUND' })) };
  const sunday = cycle.days.find(day => day.label === '일');
  const actual = (orderWeek, quantity, unit = '박스') => ({ year: 2026, orderWeek, custKey: 533, prodKey: 919,
    prodName: 'same-day tombstone fixture', outUnit: unit, detailRows: 1, state: 'FIXED_REVIEW_REQUIRED',
    shipmentOutQuantity: quantity, fixed: true,
    shipmentDates: [{ date: sunday.date, shipmentQuantity: quantity, estimateQuantity: quantity * 10 }] });
  const matrixFor = (rows, baselines = []) => buildHorizontalWeekdayMatrix([cycle], [], rows, baselines).rows[0].blocks[0];

  const liveAndZero = matrixFor([actual('38-01', 7), actual('38-02', 0)], [
    { year: 2026, orderWeek: '38-01', rows: [{ prodKey: 919, quantity: 10, unit: '박스',
      shipmentDates: [{ date: sunday.date, quantity: 10 }] }] },
    { year: 2026, orderWeek: '38-02', rows: [{ prodKey: 919, quantity: 2, unit: '박스',
      shipmentDates: [{ date: sunday.date, quantity: 2 }] }] },
  ]);
  const sundayProjection = liveAndZero.days.find(day => day.date === sunday.date);
  assert.deepEqual(sundayProjection.actualOrderWeeks, ['38-01']);
  assert.equal(sundayProjection.current, 7);
  assert.equal(sundayProjection.initial, 12, 'immutable initial total uses both raw source weeks, including the zero tombstone week');
  assert.equal(sundayProjection.initialDelta, -5, 'initial delta compares the editable 7 against baseline 10 + 2');
  assert.deepEqual(sundayProjection.actualDetails.map(item => item.shipmentQuantity), [7, 0]);
  assert.equal(liveAndZero.productActuals.find(row => row.orderWeek === '38-02').shipmentDates[0].shipmentQuantity, 0,
    'the zero tombstone remains in raw comparison evidence');
  assert.deepEqual(horizontalEditPayload({ prodKey: 919, name: 'same-day tombstone fixture' }, liveAndZero, sundayProjection, 8), {
    prodKey: 919, prodName: 'same-day tombstone fixture', unit: '박스', year: 2026,
    orderWeek: '38-01', date: sunday.date, quantity: 8,
  });

  const bothPositive = matrixFor([actual('38-01', 7), actual('38-02', 2)]).days.find(day => day.date === sunday.date);
  assert.deepEqual(bothPositive.actualOrderWeeks, ['38-01', '38-02']);
  assert.match(bothPositive.editDisabledReason, /실제 업무차수 복수/);
  assert.throws(() => horizontalEditPayload({ prodKey: 919 }, liveAndZero, bothPositive, 8));

  const bothZeroBlock = matrixFor([actual('38-01', 0), actual('38-02', 0)]);
  const bothZero = bothZeroBlock.days.find(day => day.date === sunday.date);
  assert.deepEqual(bothZero.actualOrderWeeks, ['38-01'], 'when all tombstones are zero, use the calendar day scope if present');
  assert.equal(bothZero.current, 0);
  assert.equal(horizontalEditPayload({ prodKey: 919 }, bothZeroBlock, bothZero, 1).orderWeek, '38-01');

  const unitConflictBlock = matrixFor([actual('38-01', 7), actual('38-02', 0, '단')]);
  const unitConflict = unitConflictBlock.days.find(day => day.date === sunday.date);
  assert.match(unitConflict.editDisabledReason, /단위 불명/);
  assert.throws(() => horizontalEditPayload({ prodKey: 919 }, unitConflictBlock, unitConflict, 8));

  const unknownBlock = matrixFor([actual('38-01', null), actual('38-02', 0)]);
  const unknown = unknownBlock.days.find(day => day.date === sunday.date);
  assert.equal(unknown.current, null);
  assert.match(unknown.editDisabledReason, /수량 확인 필요/);
  assert.throws(() => horizontalEditPayload({ prodKey: 919 }, unknownBlock, unknown, 8));
});
