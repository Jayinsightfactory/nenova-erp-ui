import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createCountryOrderSourceHandler, buildCountryOrderCycles, countryOrderTodayKst } from '../lib/countryOrderSourceApi.js';
const calendar = Array.from({ length: 6 }, (_, i) => ({ OrderYearWeek: `2026${42 + i}`, WeekDay: 5, BaseYmd: new Date(Date.UTC(2026, 9, 15 + i * 7)).toISOString().slice(0, 10) }));
const row = { OrderYear: '2026', OrderWeek: '42-01', CustKey: 1, CustName: '업체', CustOrderCode: 'CL21', ProdKey: 1983, ProdName: 'tulip', FlowerName: '튤립', CounName: '네덜란드', OutUnit: '단', OutQuantity: 20, BoxQuantity: 1, BunchQuantity: 20, SteamQuantity: 200, SourceRowCount: 1 };
function setup({ periods = calendar, rows = [row], hidden = 0, failAt = 0 } = {}) {
  const calls = [], handler = createCountryOrderSourceHandler({ types: { NVarChar: size => `nvarchar(${size})` }, now: () => new Date('2026-10-14T16:00:00Z'), queryFn: async (sql, params) => {
    calls.push({ sql, params }); if (calls.length === failAt) throw Error('password=secret SQL host');
    if (sql.includes('FROM PeriodDay')) return { recordset: periods };
    if (sql.includes('AS HiddenCount')) return { recordset: [{ HiddenCount: hidden }] };
    return { recordset: rows };
  } });
  const res = { code: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, handler, res };
}
test('KST today actual six cycles calendar-only does not query orders', async () => {
  const s = setup(); await s.handler({ method: 'GET', query: {} }, s.res);
  assert.equal(s.res.code, 200); assert.equal(s.res.body.todayKst, '2026-10-15'); assert.equal(s.res.body.currentCycleKey, '2026/42'); assert.equal(s.res.body.cycles.length, 6); assert.equal(s.res.body.cycles[5].startDate, '2026-11-19'); assert.equal(s.calls.length, 1);
  assert.equal(s.res.body.scope, null); assert.deepEqual(s.res.body.rows, []); assert.equal(s.res.headers['Cache-Control'], 'private, no-store');
  assert.match(s.calls[0].sql, /WeekDay=5/); assert.match(s.calls[0].sql, /BETWEEN CONVERT\(date,BaseYmd\) AND DATEADD\(day,6/);
});
test('country default current; explicit year+major scope; native full subweeks only', async () => {
  const s = setup({ rows: [{ ...row, OrderWeek: '42-03b' }, row, { ...row, OrderWeek: '42-03A' }, { ...row, OrderWeek: '42-03' }], hidden: 2 });
  await s.handler({ method: 'GET', query: { country: 'Netherlands', year: '2026', majorWeek: '42' } }, s.res);
  assert.equal(s.res.code, 200); assert.equal(s.res.body.scope.scopeKey, 'Netherlands/2026/42'); assert.equal(s.calls[1].params.orderYear.value, '2026'); assert.equal(s.calls[1].params.majorWeek.value, '42');
  assert.deepEqual(s.res.body.subweeks.map(s => s.orderWeek), ['42-01', '42-03', '42-03A', '42-03b']); assert.match(s.res.body.warnings[0], /2행/);
  assert.equal(s.res.body.diagnostics.hiddenOrderCount, 2); assert.equal(s.res.body.diagnostics.sourceRowCount, 4);
  assert.match(s.calls[1].sql, /v.OrderYear=@orderYear AND v.OrderWeek LIKE @majorWeek/); assert.match(s.calls[1].sql, /c.OrderCode AS CustOrderCode/); assert.match(s.calls[1].sql, /v.CounName=@counName AND p.CounName=@counName/);
  for (const { sql } of s.calls) assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|EXEC)\b/i);
  const current = setup(); await current.handler({ method: 'GET', query: { country: 'Netherlands' } }, current.res); assert.equal(current.res.body.scope.scopeKey, s.res.body.scope.scopeKey);
});
test('no orders has no invented subweek; missing customer code and zero quantity retained', async () => {
  const empty = setup({ rows: [] }); await empty.handler({ method: 'GET', query: { country: 'Netherlands' } }, empty.res); assert.equal(empty.res.code, 200); assert.deepEqual(empty.res.body.subweeks, []);
  const zero = setup({ rows: [{ ...row, CustOrderCode: null, SteamQuantity: 0, BunchQuantity: 120 }] }); await zero.handler({ method: 'GET', query: { country: 'Netherlands' } }, zero.res); assert.equal(zero.res.body.rows[0].SteamQuantity, 0); assert.equal(zero.res.body.rows[0].CustOrderCode, '');
});
test('nonGET and invalid queries run no reads; outside-six scope rejected after calendar', async () => {
  for (const query of [{ year: 2026 }, { country: 'Netherlands', year: 2026 }, { country: '네덜란드' }, { country: ['Netherlands'] }, { country: 'China', year: '2026', majorWeek: '0' }, { country: 'China', year: '2026 OR 1=1', majorWeek: '42' }, { unexpected: 'x' }]) {
    const s = setup(); await s.handler({ method: 'GET', query }, s.res); assert.equal(s.res.code, 400); assert.equal(s.calls.length, 0);
  }
  const post = setup(); await post.handler({ method: 'POST', query: {} }, post.res); assert.equal(post.res.code, 405); assert.equal(post.calls.length, 0);
  for (const query of [{ country: 'Netherlands', year: 2025, majorWeek: 42 }, { country: 'Netherlands', year: 2026, majorWeek: 48 }]) {
    const s = setup(); await s.handler({ method: 'GET', query }, s.res); assert.equal(s.res.code, 400); assert.equal(s.res.body.code, 'SCOPE_OUTSIDE_SIX_CYCLES'); assert.equal(s.calls.length, 1);
  }
});
test('calendar gaps duplicate keys missing current fail 409 without ISO fallback', async () => {
  for (const periods of [[], calendar.slice(1), calendar.slice(0, 5), [calendar[0], calendar[0], ...calendar.slice(2)], calendar.map((p, i) => i === 3 ? { ...p, BaseYmd: '2026-11-06' } : p)]) {
    const s = setup({ periods }); await s.handler({ method: 'GET', query: {} }, s.res); assert.equal(s.res.code, 409); assert.equal(s.res.body.success, false); assert.equal(s.res.body.rows, undefined);
  }
});
test('actual calendar year boundary and KST midnight retained', () => {
  const fridays = calendar.map(p => ({ ...p, BaseYmd: new Date(Date.parse(`${p.BaseYmd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) }));
  assert.throws(() => buildCountryOrderCycles(fridays, '2026-10-16'), /목요일/);
  const keys = ['202652', '202701', '202702', '202703', '202704', '202705'];
  const periods = keys.map((OrderYearWeek, i) => ({ OrderYearWeek, WeekDay: 5, BaseYmd: new Date(Date.UTC(2026, 11, 24 + i * 7)).toISOString().slice(0, 10) }));
  const cycles = buildCountryOrderCycles(periods, '2026-12-24'); assert.equal(cycles[1].year, 2027); assert.equal(cycles[1].majorWeek, '01'); assert.equal(cycles.length, 6);
  assert.equal(countryOrderTodayKst(new Date('2026-10-14T14:59:59Z')), '2026-10-14'); assert.equal(countryOrderTodayKst(new Date('2026-10-14T15:00:00Z')), '2026-10-15');
});
test('prior-year and foreign scope cannot appear; DB partial failures masked', async () => {
  for (const rows of [[{ ...row, OrderYear: '2025' }], [{ ...row, CounName: '중국' }], [{ ...row, OrderWeek: '43-01' }], [{ ...row, SteamQuantity: NaN }]]) {
    const s = setup({ rows }); await s.handler({ method: 'GET', query: { country: 'Netherlands' } }, s.res); assert.equal(s.res.code, 409); assert.equal(s.res.body.rows, undefined);
  }
  for (const failAt of [1, 2, 3]) { const s = setup({ failAt }); await s.handler({ method: 'GET', query: { country: 'Netherlands' } }, s.res); assert.equal(s.res.code, 500); assert.doesNotMatch(JSON.stringify(s.res.body), /password|secret|SQL|host/); assert.equal(s.res.body.rows, undefined); }
});
test('authentication wrapper and read-only dependency wiring', () => {
  const source = fs.readFileSync(new URL('../pages/api/import/tools/country-orders.js', import.meta.url), 'utf8'); assert.match(source, /withAuth\(createCountryOrderSourceHandler/); assert.doesNotMatch(source, /withTransaction|apiPost/);
});
test('Product native conversion basis SELECT GROUP BY and numeric mapper retain zero vs missing', async () => {
  const s = setup({ rows: [{ ...row, SteamOf1Bunch: '10', BunchOf1Box: 0, SteamOf1Box: null }] });
  await s.handler({ method: 'GET', query: { country: 'Netherlands' } }, s.res);
  assert.equal(s.res.code, 200); assert.equal(s.res.body.rows[0].SteamOf1Bunch, 10); assert.equal(s.res.body.rows[0].BunchOf1Box, 0); assert.equal(s.res.body.rows[0].SteamOf1Box, null);
  const [select, group] = s.calls[1].sql.split('GROUP BY');
  for (const field of ['SteamOf1Bunch', 'BunchOf1Box', 'SteamOf1Box']) { assert.ok(select.includes(`p.${field}`)); assert.ok(group.includes(`p.${field}`)); assert.doesNotMatch(select, new RegExp(`SUM\\(p\\.${field}\\)`)); }
});
test('nonfinite or invalid basis response fails without leaking partial rows', async () => {
  for (const value of [Infinity, NaN, '', true, 'not-a-number']) {
    const s = setup({ rows: [{ ...row, SteamOf1Bunch: value }] }); await s.handler({ method: 'GET', query: { country: 'Netherlands' } }, s.res);
    assert.equal(s.res.code, 409); assert.equal(s.res.body.rows, undefined);
  }
});
