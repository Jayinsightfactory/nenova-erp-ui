import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShippingCycles, normalizeCycleRequest, normalizeNextCenterDate, selectNextShippingCenter, shiftDate, SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'pages/api/estimate/weekday-calendar.js'), 'utf8');
const routeFactory = new Function('query', 'sql', 'withAuth', 'normalizeCycleRequest', 'buildShippingCycles',
  'normalizeNextCenterDate', 'selectNextShippingCenter',
  source.replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ')
    .replace('export default withAuth(createWeekdayCalendarHandler());', '') + '\nreturn createWeekdayCalendarHandler;');

const anchors = [
  { date: '2026-12-17', key: '202651' },
  { date: '2026-12-24', key: '202652' },
  { date: '2026-12-31', key: '202653' },
  { date: '2027-01-07', key: '202701' },
  { date: '2027-01-14', key: '202702' },
];
const periodRows = anchors.flatMap(({ date, key }) => SHIPPING_DAYS.map((day, index) => ({
  BaseYmd: shiftDate(date, index), WeekDay: day.code, OrderYearWeek: key,
})));

function apiFixture() {
  const calls = [];
  const types = { NVarChar: size => `nvarchar(${size})` };
  const createHandler = routeFactory(() => { throw new Error('real DB query must never run'); }, {}, handler => handler,
    normalizeCycleRequest, buildShippingCycles, normalizeNextCenterDate, selectNextShippingCenter);
  const handler = createHandler({ types, queryFn: async (statement, params) => {
    calls.push({ statement, params });
    assert.match(statement, /^\s*(?:SELECT|WITH)\b/i, 'calendar queries are read-only');
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i);
    if (params?.date) {
      assert.equal(params.date.type, 'nvarchar(10)');
      assert.match(statement, /FROM PeriodDay WHERE WeekDay=5/);
      const date = params.date.value;
      const from = shiftDate(date, -7), to = shiftDate(date, 8);
      return { recordset: periodRows.filter(row => row.WeekDay === 5 && row.BaseYmd >= from && row.BaseYmd < to) };
    }
    assert.equal(params.yearWeek.type, 'nvarchar(6)');
    assert.match(statement, /WITH anchor AS/);
    const anchorDate = anchors.find(item => item.key === params.yearWeek.value)?.date;
    assert.ok(anchorDate, `actual PeriodDay anchor exists for ${params.yearWeek.value}`);
    return { recordset: periodRows.filter(row => row.BaseYmd >= shiftDate(anchorDate, -7)
      && row.BaseYmd < shiftDate(anchorDate, 14)) };
  } });
  return { handler, calls };
}

async function request(query) {
  const { handler, calls } = apiFixture();
  const req = { method: 'GET', query };
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; } };
  await handler(req, res);
  return { res, calls };
}

test('explicit calendar selection remains backward-compatible; omitted and false/zero defaults are not guessed', async () => {
  const explicit = await request({ year: '2026', majorWeek: '52' });
  assert.equal(explicit.res.statusCode, 200, JSON.stringify(explicit.res.body));
  assert.deepEqual(explicit.res.body.scope, { year: 2026, majorWeek: '52', orderYearWeek: '202652' });
  assert.equal(explicit.calls.length, 1);
  for (const query of [{ defaultNext: '1' }, { defaultNext: '0', date: '2026-12-24' },
    { defaultNext: 'false', date: '2026-12-24' }, { defaultNext: 0, date: '2026-12-24' },
    { defaultNext: false, date: '2026-12-24' }]) {
    const result = await request(query);
    assert.equal(result.res.statusCode, 400);
    assert.equal(result.calls.length, 0, 'invalid defaults fail before any query');
  }
});

test('Korean date resolves next center from real cross-year PeriodDay anchors, not ISO week arithmetic', async () => {
  const week52 = await request({ defaultNext: '1', date: '2026-12-24' });
  assert.equal(week52.res.statusCode, 200, week52.res.body?.error);
  assert.equal(week52.res.body.scope.orderYearWeek, '202653');
  assert.equal(week52.res.body.scope.majorWeek, '53');
  assert.equal(week52.calls.length, 2);

  const week53 = await request({ defaultNext: '1', date: '2026-12-31' });
  assert.equal(week53.res.statusCode, 200, week53.res.body?.error);
  assert.equal(week53.res.body.scope.orderYearWeek, '202701');
  assert.equal(week53.res.body.scope.year, 2027);
  assert.equal(week53.res.body.scope.majorWeek, '01');
  assert.deepEqual(week53.res.body.cycles.map(cycle => `${cycle.year}${cycle.majorWeek}`), ['202653', '202701', '202702']);
  assert.ok(week53.calls[0].statement.includes('SELECT OrderYearWeek, WeekDay'));
  assert.ok(week53.calls.every(call => call.params.date?.value === '2026-12-31' || call.params.yearWeek?.value === '202701'));
});

test('date validation accepts a real supplied today and rejects malformed or impossible values', async () => {
  assert.equal(normalizeNextCenterDate('2026-12-24'), '2026-12-24');
  for (const date of [undefined, '', '2026-2-4', '2026-02-30', new Date('2026-12-24')]) assert.throws(() => normalizeNextCenterDate(date));
  const invalid = await request({ defaultNext: '1', date: '2026-02-30' });
  assert.equal(invalid.res.statusCode, 400);
  assert.equal(invalid.calls.length, 0);
});
