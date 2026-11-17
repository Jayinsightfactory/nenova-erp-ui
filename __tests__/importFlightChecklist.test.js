// 비행 스케줄 점검 규칙 테스트 — node __tests__/importFlightChecklist.test.js (전부 지어낸 값)
import assert from 'node:assert/strict';
import { quarantineDeadline, buildChecklist } from '../lib/importFlightChecklist.js';
import { buildFlightBoard } from '../lib/importFlightBoard.js';

const K = (s) => `${s}:00+09:00`;
// 2026-11-18 = 수요일
const q = (country, t) => quarantineDeadline(country, K(t));
let r = q('네덜란드', '2026-11-18T14:20');
assert.deepEqual([r.quarantineDate, r.slot, r.deadlineAt], ['2026-11-19', '오전', K('2026-11-19T09:00')]);
r = q('네덜란드', '2026-11-18T04:00');
assert.deepEqual([r.quarantineDate, r.slot], ['2026-11-18', '오전']);
r = q('콜롬비아', '2026-11-21T10:00'); // 토
assert.deepEqual([r.quarantineDate, r.slot, r.deadlineAt], ['2026-11-23', '오후', K('2026-11-23T12:00')]);
r = q('중국', '2026-11-22T10:00'); // 일
assert.deepEqual([r.quarantineDate, r.slot, r.deadlineAt], ['2026-11-24', '오전', K('2026-11-24T09:00')]);
r = q('네덜란드', '2026-11-20T20:00'); // 금
assert.deepEqual([r.quarantineDate, r.deadlineAt], ['2026-11-23', K('2026-11-23T09:00')]);
assert.equal(r.assumed, true);

const SEON = '네노바&선율방';
const base = (o = {}) => ({ country: '네덜란드', weekLabel: '47-1', awb: '180-12345697', flight: 'KL867', arriveAt: K('2026-11-18T14:20'), timeAssumed: false, status: 'before_departure', rooms: ['스케줄방', '빌번호방', SEON], changeRooms: [], isChangeNotice: false, receipt: null, registeredEarly: false, ...o });
const now = Date.parse(K('2026-11-18T10:00'));
const st = (cl, k) => cl.steps.find((s) => s.key === k);
const texts = (cl) => cl.alerts.map((a) => a.text);

let cl = buildChecklist(base(), { now, icn: null, customs: null, docsSent: null, siblings: 0 });
assert.deepEqual(cl.steps.map((s) => s.key), ['awb', 'notice', 'docs', 'departed', 'arrived', 'manifest', 'quarantine', 'cleared', 'released', 'receipt']);
assert.equal(cl.customsAvailable, false);
assert.equal(st(cl, 'awb').state, 'done');
assert.equal(st(cl, 'notice').state, 'done');
assert.equal(st(cl, 'notice').note, '3방 중 3방');
assert.equal(st(cl, 'docs').state, 'due', '검역 마감(목 09:00)까지 24시간 이내');
assert.equal(st(cl, 'manifest').state, 'wait');
assert.equal(cl.alerts.length, 0);
assert.equal(cl.quarantine.quarantineDate, '2026-11-19');

// 서류 전달 표시 → done
cl = buildChecklist(base(), { now, docsSent: { at: '2026-11-18T01:00:00Z', by: 'u1' } });
assert.equal(st(cl, 'docs').state, 'done');
// 마감 2시간 이내 + 표시 없음 → late + 경고
cl = buildChecklist(base(), { now: Date.parse(K('2026-11-19T07:00')) });
assert.equal(st(cl, 'docs').state, 'late');
assert.ok(texts(cl).some((t) => t.startsWith('검역 신청 마감(11/19 09:00 예상)이 임박')));

// 공지 방
cl = buildChecklist(base({ rooms: ['스케줄방', '빌번호방'] }), { now });
assert.equal(st(cl, 'notice').state, 'late');
assert.ok(cl.alerts.some((a) => a.level === 'red' && a.text === '도착 공지가 선율방에 없음 — 검역 신청이 빠질 수 있음'));
cl = buildChecklist(base({ rooms: ['스케줄방', SEON] }), { now });
assert.ok(cl.alerts.some((a) => a.level === 'amber' && a.text === '도착 공지가 빌번호방(백상)에 없음'));

// 공항 지연
const icn = { scheduledAt: K('2026-11-18T16:00'), estimatedAt: K('2026-11-18T16:00'), remark: null };
cl = buildChecklist(base(), { now, icn });
assert.equal(cl.actualArrival.delayMinutes, 100);
assert.ok(texts(cl).includes('공항 예정 시각이 공지와 다름: 공지 11/18 14:20 → 공항 11/18 16:00'));
assert.ok(texts(cl).includes('지연(+100분)인데 선율방에 변경 공지 없음'));
cl = buildChecklist(base({ changeRooms: [SEON], isChangeNotice: true }), { now, icn });
assert.ok(!texts(cl).some((t) => t.startsWith('지연(')));
assert.ok(!texts(cl).includes('스케줄 변경 공지가 선율방에 없음'));
cl = buildChecklist(base({ isChangeNotice: true, changeRooms: ['스케줄방'] }), { now });
assert.ok(texts(cl).includes('스케줄 변경 공지가 선율방에 없음'));
cl = buildChecklist(base(), { now, icn: { ...icn, remark: '결항' } });
assert.ok(texts(cl).includes('공항 자료: 결항'));
assert.equal(st(cl, 'arrived').state, 'late');

// 형제 편
cl = buildChecklist(base(), { now, siblings: 1 });
assert.ok(texts(cl).includes('같은 차수·나라에 비행기가 2편 — 서류·공지를 편마다 따로 보냈는지 확인'));

// 도착 요일 원칙
cl = buildChecklist(base({ country: '중국', arriveAt: K('2026-11-18T14:20') }), { now });
assert.ok(texts(cl).includes('중국은 일요일 도착 원칙 — 수요일 도착 예정'));
cl = buildChecklist(base({ country: '콜롬비아', arriveAt: K('2026-11-22T10:00') }), { now });
assert.ok(texts(cl).includes('콜롬비아 주말 도착분은 토요일 원칙 — 일요일 도착 예정'));

// 통관 진행
const cu = { found: true, manifestAt: K('2026-11-18T13:00'), arrivedAt: K('2026-11-18T14:00'), inspectionSetAt: K('2026-11-18T15:00'), quarantinePassedAt: null, quarantineFailed: false, declaredAt: K('2026-11-18T16:00'), clearedAt: null, releasedAt: null };
cl = buildChecklist(base({ status: 'arrived' }), { now: Date.parse(K('2026-11-18T17:00')), customs: cu });
assert.equal(cl.customsAvailable, true);
assert.equal(st(cl, 'docs').state, 'done');
assert.equal(st(cl, 'docs').note, '통관 진행으로 확인');
assert.equal(st(cl, 'arrived').state, 'done');
assert.equal(st(cl, 'manifest').state, 'done');
assert.equal(st(cl, 'quarantine').state, 'due');
assert.equal(st(cl, 'cleared').state, 'due');
cl = buildChecklist(base({ status: 'arrived' }), { now: Date.parse(K('2026-11-18T17:00')), customs: { ...cu, quarantineFailed: true } });
assert.equal(st(cl, 'quarantine').state, 'late');
assert.ok(texts(cl).includes('검역 불합격'));
cl = buildChecklist(base({ status: 'arrived' }), { now: Date.parse(K('2026-11-19T09:30')), customs: { found: true, manifestAt: K('2026-11-18T13:00') } });
assert.equal(st(cl, 'quarantine').note, '검역 신청 마감이 지남');
assert.ok(texts(cl).includes('검역 신청 마감이 지났는데 검사 접수가 안 보임'));

// 반출 뒤 입고 등록 지연
const rel = { ...cu, quarantinePassedAt: K('2026-11-19T09:00'), clearedAt: K('2026-11-19T12:00'), releasedAt: K('2026-11-19T13:00') };
cl = buildChecklist(base({ status: 'arrived' }), { now: Date.parse(K('2026-11-20T14:00')), customs: rel });
assert.equal(st(cl, 'released').state, 'done');
assert.equal(st(cl, 'receipt').state, 'late');
assert.equal(cl.alerts.length, 0, '반출까지 끝난 편은 경고를 만들지 않는다');

// 입고 등록 끝 + 도착 예정 지남 → 경고 없음
cl = buildChecklist(base({ status: 'registered', rooms: [], receipt: { registeredAt: K('2026-11-18T18:00') } }), { now: Date.parse(K('2026-11-19T10:00')), siblings: 2 });
assert.equal(cl.alerts.length, 0);
assert.equal(st(cl, 'receipt').state, 'done');

// 운송장 없음 → 이후 단계 wait
cl = buildChecklist(base({ awb: '' }), { now, customs: cu });
assert.ok(['docs', 'departed', 'arrived', 'manifest', 'quarantine', 'cleared', 'released', 'receipt'].every((k) => st(cl, k).state === 'wait'));

// 보드 통합: 공항 시각과 todo (선율방 공지가 없는 편이라 빨강 경고가 나온다)
const msgs = [{ chatroom: '스케줄방', sender: 's', message: '46-2차 네덜란드 홀렉스 (KLM)\n11월 18일 (수) 14:20 도착 예정\n(074-12345697 KL867 57BOX)', created_at: '2026-11-17T00:00:00Z', external_message_id: 'x1' }];
const b = buildFlightBoard({ messages: msgs, receipts: new Map(), now, icn: new Map([['KL867', icn]]), customs: new Map(), docsSent: {} });
const f = b.flights[0];
assert.equal(f.arriveAt, new Date(K('2026-11-18T14:20')).toISOString(), '편의 arriveAt 은 공지 값 유지');
assert.equal(f.actual.estimatedAt, K('2026-11-18T16:00'));
assert.ok(Array.isArray(f.alerts) && f.checklist.steps.length === 10);
assert.ok(b.todo.length >= 1 && b.todo[0].level === 'red');
assert.equal(b.summary.red + b.summary.amber, b.todo.length);
assert.ok(!f.issues.some((t) => t.includes('선율방에 없음')), 'issues 에는 경고를 섞지 않는다');

// 방 글(선율방·빌번호방) 사건 반영
const RE = (type, room, kst, text, extra = {}) => ({ type, room, at: K(kst), text, guessed: false, link: 'awb', ...extra });
const rnow = Date.parse(K('2026-11-18T12:00'));
const rb = (o) => base({ status: 'arrived', arriveAt: K('2026-11-18T08:00'), ...o });
cl = buildChecklist(rb(), { now: rnow, roomEvents: [RE('quarantine_pass', SEON, '2026-11-18T10:00', '합격 나왔습니다', { guessed: true })] });
assert.equal(st(cl, 'quarantine').state, 'done');
assert.equal(st(cl, 'quarantine').note, '선율방 글 기준 (추정 연결)');
cl = buildChecklist(rb(), { now: rnow, roomEvents: [RE('quarantine_fail', SEON, '2026-11-18T10:00', '불합격')] });
assert.equal(st(cl, 'quarantine').state, 'late');
assert.equal(st(cl, 'quarantine').note, '불합격·폐기 글');
assert.ok(texts(cl).some((t) => t.startsWith('검역 불합격·폐기 글 (11/18 10:00)')));
assert.ok(!texts(cl).includes('검역 신청 마감이 지났는데 검사 접수가 안 보임'));
cl = buildChecklist(rb(), { now: rnow, roomEvents: [RE('warehoused', '빌번호방', '2026-11-18T09:00', '오늘 반입 된거네요'), RE('manifest_qty', '빌번호방', '2026-11-18T07:00', '180-12345697 / 57CT')] });
assert.equal(st(cl, 'arrived').state, 'done');
assert.equal(st(cl, 'arrived').note, '빌번호방 글 기준');
assert.equal(st(cl, 'manifest').state, 'done');
assert.equal(st(cl, 'manifest').note, '빌번호방 수량 확인');
cl = buildChecklist(rb(), { now: rnow, customs: { found: true, arrivedAt: K('2026-11-18T07:50') }, roomEvents: [RE('warehoused', '빌번호방', '2026-11-18T09:00', '오늘 반입 된거네요')] });
assert.equal(st(cl, 'arrived').note, '', '통관 근거가 우선');
cl = buildChecklist(rb({ arriveAt: K('2026-11-18T20:00') }), { now: rnow, roomEvents: [RE('warehoused', '빌번호방', '2026-11-18T09:00', '오늘 반입 된거네요')] });
assert.equal(st(cl, 'arrived').state, 'wait', '도착 예정 전이면 근거로 안 씀');

// 서류 요청: 미해결 → docs late + red / 뒤 합격·진행·서류 표시 → 없음
const req = RE('docs_request', SEON, '2026-11-18T09:00', '상기 건 서류 부탁 드립니다');
cl = buildChecklist(base(), { now: rnow, roomEvents: [req] });
assert.equal(st(cl, 'docs').state, 'late');
assert.equal(st(cl, 'docs').note, '선율이 서류를 요청함');
assert.ok(cl.alerts.some((a) => a.level === 'red' && a.text === '선율이 서류를 요청함 (11/18 09:00): 상기 건 서류 부탁 드립니다'));
cl = buildChecklist(base(), { now: rnow, roomEvents: [{ ...req, guessed: true, link: 'thread' }] });
assert.ok(texts(cl).some((t) => t.endsWith(' · 추정 연결')));
cl = buildChecklist(base(), { now: rnow, roomEvents: [req, RE('quarantine_pass', SEON, '2026-11-18T10:00', '합격')] });
assert.ok(!texts(cl).some((t) => t.startsWith('선율이 서류를 요청함')));
assert.notEqual(st(cl, 'docs').state, 'late');
cl = buildChecklist(base(), { now: rnow, roomEvents: [req, RE('quarantine_plan', SEON, '2026-11-18T10:00', '오후 검역 진행됩니다')] });
assert.ok(!texts(cl).some((t) => t.startsWith('선율이 서류를 요청함')));
cl = buildChecklist(base(), { now: rnow, docsSent: { at: K('2026-11-18T09:30'), by: 'u1' }, roomEvents: [req] });
assert.equal(st(cl, 'docs').state, 'done');
assert.ok(!texts(cl).some((t) => t.startsWith('선율이 서류를 요청함')));
cl = buildChecklist(base(), { now: rnow, docsSent: { at: K('2026-11-18T08:30'), by: 'u1' }, roomEvents: [req] });
assert.equal(st(cl, 'docs').state, 'late', '요청보다 앞선 전달 표시는 풀어 주지 않음');

// 그 밖의 경고
cl = buildChecklist(base(), { now: rnow, roomEvents: [
  RE('partial_arrival', '빌번호방', '2026-11-18T09:00', '999CT만 입항 잔량스케줄'), RE('qty_mismatch', SEON, '2026-11-18T09:01', '수량이 상이'),
  RE('lmo', SEON, '2026-11-18T09:02', 'LMO'), RE('customs_inspection', SEON, '2026-11-18T09:03', '세관 검사 걸렸습니다'),
  RE('arrival_late', '빌번호방', '2026-11-18T09:04', '입항이 늦어'), RE('docs_pending_staff', SEON, '2026-11-18T09:05', '아직 서류 못')] });
const lv = (p) => cl.alerts.find((a) => a.text.startsWith(p));
assert.equal(lv('일부만 입항·잔량 있음 (11/18 09:00): 999CT만 입항 잔량스케줄').level, 'red');
assert.equal(lv('선율: 검역증과 인보이스 수량이 다르다고 함 (11/18 09:01)').level, 'red');
assert.equal(lv('선율: LMO 부기·검사 건 (11/18 09:02)').level, 'red');
assert.equal(lv('세관 검사 걸림 (11/18 09:03)').level, 'amber');
assert.equal(lv('입항·입고가 늦어진다는 글 (11/18 09:04)').level, 'amber');
assert.equal(lv('서류를 아직 못 받았다는 글이 있음 (11/18 09:05)').level, 'amber');
// 48시간 지난 사건은 경고 없음, 입고 끝난 편도 없음
cl = buildChecklist(base(), { now: Date.parse(K('2026-11-21T12:00')), roomEvents: [RE('partial_arrival', '빌번호방', '2026-11-18T09:00', '잔량'), req] });
assert.ok(!texts(cl).some((t) => /잔량|서류를 요청/.test(t)));
cl = buildChecklist(base({ status: 'registered', receipt: { registeredAt: K('2026-11-18T18:00') }, arriveAt: K('2026-11-18T08:00') }), { now: rnow, roomEvents: [RE('partial_arrival', '빌번호방', '2026-11-18T09:00', '잔량')] });
assert.equal(cl.alerts.length, 0);

console.log('importFlightChecklist tests passed');
