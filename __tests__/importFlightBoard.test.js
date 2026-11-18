// 홈 수입 비행기 현황 조립 테스트 — node __tests__/importFlightBoard.test.js
// 운송장 번호는 전부 지어낸 값이다.
import assert from 'node:assert/strict';
import { buildFlightBoard } from '../lib/importFlightBoard.js';
import { feedWindows, isoKst, readImportScheduleFeed } from '../lib/importScheduleFeed.js';

const msg = (id, room, createdAt, message) => ({ chatroom: room, sender: '수입부', message, created_at: createdAt, external_message_id: id });
const now = Date.parse('2026-11-16T22:00:00+09:00');

const messages = [
  // 콜롬비아: 도착 전에 입고 등록이 끝난 편 → 비행 중으로 보여야 한다
  msg('a1', '스케줄방', '2026-11-16T00:10:00Z', '< 46-2 콜롬비아 최종 스케줄 >\n＊화요일＊\n46-2차 콜카장수국 (AIR CANADA)\n11월 17일(화) 17:10 도착 예정\n(014-12345675 AC063 597 BOX)\n카네이션: 300 박스\n장미: 297 박스'),
  // 태국: 사전 공지(빌번호 없음) 뒤에 빌번호 공지 → 한 편으로 합쳐지고 사전 공지는 따로 남지 않는다
  msg('b1', '빌번호방', '2026-11-13T02:00:00Z', '46-2차 태국 (KOREAN AIR)\n11월 15일 (일) 06:55 도착 예정\n(180-  KE652 _ box)'),
  msg('b2', '빌번호방', '2026-11-14T02:00:00Z', '46-2차 태국 (KOREAN AIR)\n11월 15일 (일) 06:55 도착 예정\n(180-12345686 KE652 10 BOX)'),
  // 네덜란드: 내일 도착(직항 약 11시간이라 아직 출발 전), 빌번호만 적힌 줄
  msg('c1', '네노바&선율방', '2026-11-16T03:00:00Z', '* 46-2차 네덜란드 홀렉스*\n11월 17일 (화) 오후 4시 50분 도착 예정\n18012345697 57BOX'),
  // 빌번호 없는 사전 공지: 도착 예정이 아직 안 지났으면 "빌번호 대기"
  msg('d1', '스케줄방', '2026-11-16T04:00:00Z', '< 중국 스케줄 공유 >\n47-1 중국 CLOUD\n11월 18일 (수) 오전 8시 10분 도착 예정'),
  // 빌번호 없는 사전 공지인데 도착 예정이 12시간 넘게 지남 → 목록에서 빠진다
  msg('e1', '스케줄방', '2026-11-12T04:00:00Z', '46-1차 미국 (KOREAN AIR)\n11월 14일 (토) 04:00 도착 예정'),
];
const receipts = new Map([
  ['01412345675|2026|46-2', { registeredAt: '2026-11-16T08:25:00+09:00', orderWeek: '46-02', masters: 20, farms: 18, boxes: 597, country: '콜롬비아', items: [{ name: '카네이션', box: 300 }, { name: '장미', box: 297 }] }],
  ['18012345686|2026|46-2', { registeredAt: '2026-11-16T09:10:00+09:00', orderWeek: '46-02', masters: 1, farms: 1, boxes: 10, country: '태국', items: [{ name: '덴파레', box: 10 }] }],
  ['99912345675|2026|46-2', { registeredAt: '2026-11-16T10:00:00+09:00', orderWeek: '46-02', masters: 1, farms: 1, boxes: 30, country: '중국', items: [] }],
]);

receipts.set('01412345675|2025|46-2', { ...receipts.get('01412345675|2026|46-2'), registeredAt: '2025-11-16T08:25:00+09:00', boxes: 999 });
const board = buildFlightBoard({ messages, receipts, now });
const by = key => board.flights.find(f => f.key === key);

const col = by('01412345675');
assert.equal(col.status, 'in_flight', '도착 전 입고 등록된 콜롬비아 편은 비행 중');
assert.equal(col.registeredEarly, true);
assert.ok(col.progress > 0 && col.progress < 1);
assert.equal(col.contents.source, '전산 입고');
assert.equal(col.box, 597);
assert.equal(col.awb, '014-12345675');
assert.ok(col.route.length > 10 && col.position, '예측 위치와 경로가 있다');
assert.ok(col.links.flightTrack.endsWith('/ac63') || col.links.flightTrack.endsWith('/ac063'));
assert.ok(!JSON.stringify(col.links).includes('12345675'), '운송장 번호는 외부 주소에 넣지 않는다');

const th = by('18012345686');
assert.equal(th.status, 'registered', '도착 예정이 지났고 입고 등록됨');
assert.equal(th.mentions, 2, '사전 공지가 빌번호 공지에 합쳐진다');
assert.equal(board.flights.filter(f => f.country === '태국').length, 1);

const nl = by('18012345697');
assert.equal(nl.status, 'before_departure', '도착 18시간 전 — 직항 소요 약 11시간이라 출발 전');
assert.equal(nl.progress, 0);
assert.equal(nl.arrivalTime, '16:50');
assert.ok(nl.issues.includes('편명 아직 없음'));

const cn = board.flights.find(f => f.country === '중국');
assert.equal(cn.status, 'awaiting_awb');
assert.ok(cn.issues.includes('빌번호 아직 없음'));

assert.equal(board.flights.some(f => f.country === '미국'), false, '도착 예정이 지난 빌번호 없는 사전 공지는 뺀다');
assert.equal(board.unannounced.length, 1, '공지에서 못 찾은 최근 입고 등록 1건');
assert.equal(board.unannounced[0].awb, '999-12345675');
assert.equal(board.summary.total, board.flights.length);
assert.equal(board.summary.inFlight, 1);
assert.equal(board.summary.beforeDeparture, 1);
assert.equal(board.summary.registered, 1);
assert.equal(board.summary.awaitingAwb, 1);
assert.equal(board.issues.length, board.flights.reduce((n, f) => n + f.issues.length, 0));
// 비행 중인 편이 맨 위
assert.equal(board.flights[0].status, 'in_flight');

// 방 글 연결: 선율방 서류 요청·빌번호방 수량 글이 편에 붙고, 못 붙인 위험 글은 roomNews 로
{
  const rmsgs = [
    ...messages,
    msg('r1', '네노바&선율방', '2026-11-16T10:30:00Z', '46-2차 네덜란드\n상기 9농장 서류 요청 드립니다'),
    msg('r2', '빌번호방', '2026-11-16T11:00:00Z', '180-12345697 / 57CT\n수량 맞습니다'),
    msg('r3', '네노바&선율방', '2026-11-16T12:00:00Z', '어느 편인지 모를 글 LMO 부기가 없습니다'),
    msg('r4', '네노바&선율방', '2026-11-10T11:30:00Z', '어느 편인지 모를 글 LMO 부기가 없습니다'),
  ];
  const b2 = buildFlightBoard({ messages: rmsgs, receipts, now });
  const nl2 = b2.flights.find(f => f.key === '18012345697');
  assert.ok(nl2.noticeMessageIds.includes('c1'));
  assert.ok(nl2.roomEvents.length >= 2 && nl2.roomEvents.length <= 8);
  assert.deepEqual(Object.keys(nl2.roomEvents[0]).sort(), ['at', 'guessed', 'label', 'level', 'link', 'messageId', 'room', 'text', 'type']);
  assert.ok(Date.parse(nl2.roomEvents[0].at) >= Date.parse(nl2.roomEvents[1].at), '최근 것부터');
  assert.ok(nl2.roomEvents.some(e => e.type === 'docs_request' && e.room === '선율'));
  assert.equal(nl2.checklist.steps.find(s => s.key === 'docs').state, 'late');
  assert.ok(nl2.alerts.some(a => a.level === 'red' && a.text.startsWith('선율이 서류를 요청함')));
  assert.ok(b2.todo.some(t => t.key === '18012345697' && t.text.startsWith('선율이 서류를 요청함')));
  assert.equal(b2.roomNews.length, 1, '붙이지 못한 위험 글 중 48시간 안의 것만');
  assert.equal(b2.roomNews[0].type, 'lmo');
  assert.equal(board.roomNews.length, 0);
}

// 공지도 입고 기록도 없으면 빈 목록
const empty = buildFlightBoard({ messages: [], receipts: new Map(), now });
assert.deepEqual(empty.flights, []);
assert.equal(empty.summary.total, 0);

// 통로 조회 기간: 14일을 7일 이하 창 2개로, 한국 시간 오프셋
const wins = feedWindows(now, 14);
assert.ok(wins.length >= 2 && wins.length <= 3, '14일은 7일 이하 창 2~3개');
assert.ok(wins.every(w => /\+09:00$/.test(w.from) && /\+09:00$/.test(w.to)));
assert.ok(wins.every(w => Date.parse(w.to) - Date.parse(w.from) <= 7 * 864e5));
assert.equal(isoKst(Date.parse('2026-11-16T13:00:00Z')), '2026-11-16T22:00:00+09:00');

// 통로 응답 검증: 방 이름이 다르면 그 방만 실패 처리하고 나머지는 돌려준다
const fakeFetch = async url => {
  const room = url.searchParams.get('room');
  const rows = room === '빌번호방'
    ? [{ chatroom: '다른방', chat_id: 'x', external_message_id: 'z1', message: 'x', created_at: '2026-11-16T00:00:00Z' }]
    : [{ chatroom: room, chat_id: room, external_message_id: `${room}-${url.searchParams.get('from')}`, sender: 's', message: 'm', created_at: '2026-11-16T00:00:00Z' }];
  return { ok: true, json: async () => ({ ok: true, messages: rows, hasMore: false, nextAfterKey: rows[0].external_message_id }) };
};
const feed = await readImportScheduleFeed('test-token-not-real', { days: 14, now, fetchImpl: fakeFetch });
assert.equal(feed.rooms['빌번호방'].error, 'scope');
assert.equal(feed.rooms['스케줄방'].error, null);
assert.ok(feed.rooms['스케줄방'].count >= 2);
assert.ok(feed.messages.every(m => m.chatroom !== '다른방'));

// ── 공지와 공항 자료가 크게 어긋나면(같은 편명의 다른 날 비행기) 공항 시각으로 '비행 중'이라고 하지 않는다 ──
{
  const t = Date.parse('2026-11-17T17:30:00+09:00');
  const m = [msg('z1', '스케줄방', '2026-11-17T01:15:00Z', ['< 콜롬비아 스케줄 변경 >', '47-1차 콜수국 (KALITTA)', '11월 18일(수) 17:10 도착 예정', '(992-12345675 K4254 480 BOX)'].join(String.fromCharCode(10)))];
  const far = new Map([['K4254', { scheduledAt: '2026-11-17T22:30:00+09:00', estimatedAt: '2026-11-17T22:30:00+09:00', remark: null, airportCode: 'CVG', airportName: '신시내티', cargo: true, flightId: 'K4254', aircraftRegNo: 'N773CK', aircraftType: '77L' }]]);
  const b1 = buildFlightBoard({ messages: m, receipts: new Map(), now: t, icn: far });
  const f1 = b1.flights[0];
  assert.equal(f1.via.code, 'CVG', '경유지는 공항 자료의 출발 공항');
  assert.equal(f1.phase, 'layover', '공지 도착(11/18 17:10) 기준으로는 마지막 비행기가 아직 뜨지 않았다');
  assert.ok(/신시내티 경유지 대기/.test(f1.statusLabel), f1.statusLabel);
  assert.ok(!/비행 중/.test(f1.statusLabel));
  assert.ok(/공지 시각 기준/.test(f1.note), f1.note);
  assert.equal(f1.actual, null, '다른 운항일 자료로 도착·검역마감·이슈를 만들지 않는다');
  // 공지와 공항 자료가 3시간 안이면 공항 시각으로 계산하고, 비행 중이어도 예측이라고 적는다
  const near = new Map([['K4254', { scheduledAt: '2026-11-18T18:00:00+09:00', estimatedAt: '2026-11-18T18:00:00+09:00', remark: null, airportCode: 'CVG', airportName: '신시내티', cargo: true, flightId: 'K4254' }]]);
  const b2 = buildFlightBoard({ messages: [msg('z2', '스케줄방', '2026-11-17T01:15:00Z', ['47-1차 콜수국 (KALITTA)', '11월 18일(수) 17:10 도착 예정', '(992-12345675 K4254 480 BOX)'].join(String.fromCharCode(10)))], receipts: new Map(), now: Date.parse('2026-11-18T12:00:00+09:00'), icn: near });
  const f2 = b2.flights[0];
  assert.equal(f2.phase, 'leg2');
  assert.ok(f2.statusLabel.includes('신시내티 → 인천 비행 중(예측)'), f2.statusLabel);
  assert.ok(/공항 일정 기준/.test(f2.note), f2.note);
}

console.log('importFlightBoard tests passed');
