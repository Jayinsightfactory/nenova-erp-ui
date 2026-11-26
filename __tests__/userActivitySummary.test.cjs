// 화면 사용 기록 날짜별 집계 — 하루치를 한 번만 읽고, 지난 날은 적어 두며, 계정 이름·번호를 돌려주지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'act-sum-'));
process.env.NENOVA_ACTIVITY_DIR = dir;
const S = require('../lib/userActivitySummary.cjs');

let seq = 0;
function put(day, hour, row) {
  const d = path.join(dir, day, hour); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, crypto.createHash('sha256').update(String(++seq)).digest('hex') + '.jsonl'), JSON.stringify(row) + '\n');
}
put('2026-10-14', '01', { userId: 'u1', userName: '가나다', kind: 'click', path: '/api/x', pagePath: '/estimate', source: 'web' });
put('2026-10-14', '01', { userId: 'u2', userName: '라마바', kind: 'navigation', path: '/estimate', source: 'desktop' });
put('2026-10-14', '09', { userId: 'u1', kind: 'click', path: '/orders/paste', source: 'web' });
put('2026-10-15', '03', { userId: 'u1', kind: 'click', path: '/estimate', source: 'web' });
fs.writeFileSync(path.join(dir, '2026-10-15', '03', 'not-an-event.txt'), 'x');
fs.writeFileSync(path.join(dir, '2026-10-15', '03', 'a'.repeat(64) + '.jsonl'), '{깨진 줄');

test('화면 주소별 건수 · 계정 수 · 쓴 날 수를 센다(쿼리가 붙은 화면 주소가 있으면 그것 기준)', async () => {
  const r = await S.summarizeRange({ from: '2026-10-14', to: '2026-10-15', now: new Date('2026-11-26T00:00:00Z') });
  assert.deepEqual(r.doneDays, ['2026-10-14', '2026-10-15']); assert.deepEqual(r.pendingDays, []);
  const est = r.paths.find((p) => p.path === '/estimate');
  assert.deepEqual({ events: est.events, accounts: est.accounts, days: est.days, desktop: est.desktop }, { events: 3, accounts: 2, days: 2, desktop: 1 });
  assert.equal(r.paths.find((p) => p.path === '/orders/paste').events, 1);
  assert.equal(r.total, 4, '깨진 파일과 다른 파일은 세지 않는다');
  assert.deepEqual(r.perDay, { '2026-10-14': 3, '2026-10-15': 1 });
});

test('돌려주는 값에 계정 번호·이름이 없다', async () => {
  const raw = JSON.stringify(await S.summarizeRange({ from: '2026-10-14', to: '2026-10-15', now: new Date('2026-11-26T00:00:00Z') }));
  for (const w of ['u1', 'u2', '가나다', '라마바', 'userId', 'userName']) assert.ok(!raw.includes(w), `응답에 ${w} 가 없어야 함`);
});

test('지난 날은 적어 두고 다시 읽지 않는다, 오늘은 적어 두지 않는다', async () => {
  assert.ok(fs.existsSync(path.join(dir, '_summary', '2026-10-14.json')));
  put('2026-10-14', '10', { userId: 'u3', kind: 'click', path: '/estimate', source: 'web' });
  const again = await S.summarizeRange({ from: '2026-10-14', to: '2026-10-14', now: new Date('2026-11-26T00:00:00Z') });
  assert.equal(again.paths.find((p) => p.path === '/estimate').events, 2, '적어 둔 값을 쓴다');
  put('2026-11-26', '02', { userId: 'u1', kind: 'click', path: '/pm', source: 'web' });
  await S.summarizeRange({ from: '2026-11-26', to: '2026-11-26', now: new Date('2026-11-26T05:00:00Z') });
  assert.ok(!fs.existsSync(path.join(dir, '_summary', '2026-11-26.json')), '오늘은 아직 쌓이는 중');
});

test('시간 예산을 넘기면 남은 날을 pending 으로 돌려주고, 기간이 틀리면 거절한다', async () => {
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) put(d, '01', { userId: 'u1', kind: 'click', path: '/estimate', source: 'web' });
  const r = await S.summarizeRange({ from: '2026-10-20', to: '2026-10-22', budgetMs: -1, now: new Date('2026-11-26T00:00:00Z') });
  assert.deepEqual(r.doneDays, ['2026-10-20']); assert.deepEqual(r.pendingDays, ['2026-10-21', '2026-10-22']);
  await assert.rejects(() => S.summarizeRange({ from: '2026-10-22', to: '2026-10-20' }), /INVALID_DATE_RANGE/);
  await assert.rejects(() => S.summarizeRange({ from: '2026-01-01', to: '2026-10-20' }), /INVALID_DATE_RANGE/);
  await assert.rejects(() => S.summarizeRange({ from: 'x', to: 'y' }), /INVALID_DATE_RANGE/);
});

test('창구는 볼 권한이 있는 계정에게만 집계를 준다', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'work', 'activity.js'), 'utf8');
  assert.ok(api.indexOf("isOrbitReportViewer(req.user)) return res.status(404)") < api.indexOf("req.query.summary === '1'"), '권한 확인 뒤에 집계');
});
