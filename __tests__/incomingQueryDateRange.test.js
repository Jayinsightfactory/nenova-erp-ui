import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { incomingQueryDateRange } from '../lib/incomingQueryDateRange.js';

const range = (instant, search = '') => incomingQueryDateRange(search, new Date(instant));
for (const [instant, startDate, endDate] of [
  ['2026-10-27T03:00:00Z', '2026-07-27', '2026-10-27'],
  ['2026-05-31T03:00:00Z', '2026-02-28', '2026-05-31'],
  ['2024-05-31T03:00:00Z', '2024-02-29', '2024-05-31'],
  ['2026-01-31T03:00:00Z', '2025-10-31', '2026-01-31'],
  ['2026-03-31T03:00:00Z', '2025-12-31', '2026-03-31'],
  ['2026-10-26T14:59:59Z', '2026-07-26', '2026-10-26'],
  ['2026-10-26T15:00:00Z', '2026-07-27', '2026-10-27'],
  ['2025-12-31T15:00:00Z', '2025-10-01', '2026-01-01'],
]) assert.deepEqual(range(instant), { startDate, endDate }, instant);

const now = '2026-10-26T16:00:00Z';
assert.deepEqual(range(now, '?from=2025-01-01&to=2025-02-03'), { startDate: '2025-01-01', endDate: '2025-02-03' });
assert.deepEqual(range(now, '?from=2025-01-01'), { startDate: '2025-01-01', endDate: '2026-10-27' });
assert.deepEqual(range(now, '?to=2025-02-03'), { startDate: '2026-07-27', endDate: '2025-02-03' });
assert.deepEqual(range(now, '?from=&to='), range(now));
assert.deepEqual(range(now, '?from=0&to=invalid'), { startDate: '0', endDate: 'invalid' }, 'Do not silently introduce a new URL validation policy.');

const helperUrl = new URL('../lib/incomingQueryDateRange.js', import.meta.url).href;
for (const TZ of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
  const code = `import { incomingQueryDateRange } from ${JSON.stringify(helperUrl)}; console.log(JSON.stringify(incomingQueryDateRange('', new Date(${JSON.stringify(now)}))));`;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.deepEqual(JSON.parse(result), range(now), `host timezone ${TZ}`);
}

// Execute the actual mount initialization (no React render or network/DB needed).
const page = fs.readFileSync(new URL('../pages/incoming.js', import.meta.url), 'utf8');
const marker = '  useEffect(() => {';
const begin = page.indexOf(marker) + marker.length;
const end = page.indexOf('  }, []);', begin);
assert.ok(begin >= marker.length && end > begin, 'Find initial mount effect');
const effect = page.slice(begin, end);
const initialize = new Function('Date', 'window', 'localStorage', 'incomingQueryDateRange', 'setStartDate', 'setEndDate', 'setUploadMeta', 'setFarmFilter', 'setWeekFilter', 'setMasterSearch', 'setRecentFarms', 'urlApplied', effect);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
for (const search of ['', '?from=2025-12-01&to=2026-01-31&farm=EXCEL&week=39-01&q=test', '?from=2025-01-01', '?to=2026-10-25']) {
  const state = {}, applied = { current: false };
  initialize(FixedDate, { location: { search } }, { getItem: () => '[]' }, incomingQueryDateRange,
    v => { state.startDate = v; }, v => { state.endDate = v; }, fn => { state.upload = fn({ farmName: 'KEEP' }); },
    v => { state.farm = v; }, v => { state.week = v; }, v => { state.search = v; }, v => { state.recent = v; }, applied);
  assert.deepEqual({ startDate: state.startDate, endDate: state.endDate }, range(now, search));
  assert.deepEqual(state.upload, { farmName: 'KEEP', inputDate: '2026-10-26' }, 'Preserve existing UTC upload default independently of KST query date');
  assert.equal(applied.current, true);
  if (search.includes('farm=')) assert.deepEqual([state.farm, state.week, state.search], ['EXCEL', '39-01', 'test']);
}
assert.match(page, /apiGetExe\('\/api\/warehouse', \{ startDate, endDate \}\)/);
assert.match(page, /if \(startDate && endDate\) load\(\)/);
assert.match(page, /q\.set\('from', startDate\); q\.set\('to', endDate\)/);
assert.doesNotMatch(effect, /fetch\(|apiGet|apiPost|apiPut|apiPatch|apiDelete/);
const sql = fs.readFileSync(new URL('../lib/exeWarehouseViewSql.js', import.meta.url), 'utf8');
assert.match(sql, /CONVERT\(DATE, wm\.UploadDtm\) BETWEEN @startDate AND @endDate/);
console.log('✓ 입고 조회기간: 한국 달력 3개월, 월말·연도·URL 보존, 업로드 기본값 불변');
