// 아침 브리핑 카드 변환(순수 함수) 검사. DB·네트워크 없이 실행.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BRIEFING_SOURCES, buildBriefing, todayKst, won } from '../lib/morningBriefing.js';

const ok = (data) => ({ ok: true, data });
const today = '2026-11-14';

// 1) 읽기 전용: 브리핑이 부르는 주소는 전부 조회(GET)용이고, 화면·변환 코드에 쓰기 호출이 없다.
for (const source of BRIEFING_SOURCES) assert.match(source.path, /^\/api\//);
for (const file of ['pages/briefing.js', 'lib/morningBriefing.js']) {
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]|apiPost|apiPut|apiPatch|apiDelete/, `${file} 에 쓰기 호출 금지`);
  assert.doesNotMatch(text, /components\/Layout/, `${file} 는 Layout 을 다시 감싸지 않는다`);
}

// 2) 급한 것이 있으면 빨강이 맨 위, 숫자는 원본 응답 그대로.
const full = buildBriefing({
  orderRequests: ok({ requests: [{ CustName: '가나꽃집', OrderWeek: '46-01', itemCount: 3, RequesterName: '홍길동' }, { CustName: '다라', OrderWeek: '46-01', itemCount: 1 }] }),
  approvals: ok({ rows: [] }),
  incoming: ok({ rows: [
    { week: '46-01', farm: 'A농장', eta: '2026-11-12', stage: '선적', late: true },
    { week: '46-01', farm: 'B농장', eta: today, stage: '통관중', late: false },
    { week: '46-02', farm: 'C농장', eta: '2026-11-20', stage: '발주', late: false },
  ] }),
  week: ok({ year: 2026, week: '46-01', kpi: { orderCount: 12, custCount: 5, totalSales: 1000000, totalWithVat: 1100000, unfixedCount: 0, lowStockCount: 0 } }),
  receivables: ok({ asOf: today, source: '테스트', totals: { total: 5000000, d0_30: 3000000, d31_60: 1000000, d61_90: 0, d90p: 1000000 }, rows: [{ custName: '오래된집', d90p: 1000000 }, { custName: '정상집', d90p: 0 }] }),
  creditLimit: ok({ rows: [{ signboard: '한도집', status: 'ok', limitKRW: 1000000, balance: 100000, pct: 10 }] }),
}, { today, isAdmin: true });

assert.equal(full.cards.length, 6);
assert.equal(full.overall, 'red');
assert.deepEqual(full.tally, { red: 3, amber: 0, green: 3, gray: 0 });
assert.equal(full.summary, '바로 확인할 것 3가지');
assert.deepEqual(full.cards.slice(0, 3).map((c) => c.status), ['red', 'red', 'red']);
const byId = Object.fromEntries(full.cards.map((c) => [c.id, c]));
assert.equal(byId.orderRequests.headline, '2건 대기');
assert.equal(byId.incoming.headline, '예정일 지남 1건');
assert.match(byId.incoming.lines[0], /진행 중 3건 · 오늘 도착 1건 · 예정일 지남 1건/);
assert.equal(byId.receivables.headline, '90일 넘은 미수 1,000,000원 · 1곳');
assert.match(byId.receivables.lines[0], /미수 합계 5,000,000원/);
assert.equal(byId.week.status, 'green');
assert.equal(byId.approvals.status, 'green');
assert.equal(byId.creditLimit.status, 'green');

// 3) 한국 오전(원본 late 가 아직 false)에도 어제 예정 건은 '예정일 지남'으로 잡는다. 도착·입고등록은 제외.
const morning = buildBriefing({ incoming: ok({ rows: [
  { week: '46-01', farm: 'A', eta: '2026-11-13', stage: '선적', late: false },
  { week: '46-01', farm: 'B', eta: '2026-11-13', stage: '도착', late: false },
  { week: '46-01', farm: 'C', eta: '2026-11-13', stage: '입고등록', matched: { n: 1 }, late: false },
] }) }, { today });
assert.equal(morning.cards.find((c) => c.id === 'incoming').headline, '예정일 지남 1건');

// 4) 조회 실패는 0·초록이 아니라 '확인 못 함', 권한 없음은 '관리자 전용'.
const broken = buildBriefing({
  orderRequests: { ok: false, status: 500, error: 'DB 연결 실패' },
  incoming: ok({ rows: [] }),
  week: ok({ year: 2026, week: '46-01', kpi: { unfixedCount: 4, lowStockCount: 2 } }),
  receivables: { ok: false, status: 403, error: '권한' },
}, { today, isAdmin: true });
const failed = broken.cards.find((c) => c.id === 'orderRequests');
assert.equal(failed.status, 'gray');
assert.equal(failed.statusLabel, '확인 못 함');
assert.deepEqual(failed.lines, ['DB 연결 실패']);
assert.equal(broken.cards.find((c) => c.id === 'receivables').statusLabel, '관리자 전용');
assert.equal(broken.cards.find((c) => c.id === 'approvals').status, 'gray'); // 응답 자체가 없을 때도 회색
assert.equal(broken.cards.find((c) => c.id === 'week').headline, '미확정 4건');
assert.equal(broken.overall, 'amber');

// 5) 관리자가 아니면 관리자 카드를 만들지 않는다.
const staff = buildBriefing({ orderRequests: ok({ requests: [] }), incoming: ok({ rows: [] }), week: ok({ kpi: {} }) }, { today, isAdmin: false });
assert.deepEqual(staff.cards.map((c) => c.id).sort(), ['incoming', 'orderRequests', 'week']);
assert.equal(staff.summary, '오늘은 급한 것이 없습니다');

// 6) 한도 미설정은 초록이 아니다. 전부 실패면 전체가 회색.
assert.equal(buildBriefing({ creditLimit: ok({ rows: [{ status: 'none', limitKRW: null, balance: 5 }] }) }, { today, isAdmin: true }).cards.find((c) => c.id === 'creditLimit').statusLabel, '한도 미설정');
assert.equal(buildBriefing({}, { today, isAdmin: true }).overall, 'gray');

// 7) 날짜·금액 표기.
assert.equal(todayKst(Date.UTC(2026, 10, 13, 15, 30)), '2026-11-14'); // UTC 13일 15:30 = 한국 14일 00:30
assert.equal(won(1234567.4), '1,234,567원');

console.log('morningBriefing: ok');
