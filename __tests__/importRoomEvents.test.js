// 빌번호방·선율방 글 → 사건 읽기·편 연결 테스트 — node __tests__/importRoomEvents.test.js (번호·차수는 전부 지어낸 값)
import assert from 'node:assert/strict';
import { ROOM_EVENT_TYPES, extractRoomEvents, linkRoomEvents } from '../lib/importRoomEvents.js';

const SEON = '네노바&선율방';
const AWB = '빌번호방';
let seq = 0;
const msg = (room, iso, message) => ({ chatroom: room, sender: 's', message, created_at: iso, external_message_id: `m${++seq}` });
const types = (room, text, iso = '2026-11-16T05:00:00Z') => extractRoomEvents([msg(room, iso, text)]).map((e) => e.type).sort();

assert.equal(ROOM_EVENT_TYPES.length, 19);

// 선율방 틀
assert.deepEqual(types(SEON, '46-2차 태국 합격 나왔고 검사 아닙니다'), ['quarantine_pass']);
assert.deepEqual(types(SEON, '중국 건 이상없이 합격 나왔습니다\nA 차는 검사 아니고\nB 차는 세관 검사걸렸습니다\nB차 검사시간은 9시 정도 예상됩니다'), ['customs_inspection', 'quarantine_pass']);
assert.deepEqual(types(SEON, '금일 3건\n합격 나왔고 검사 없습니다'), ['quarantine_pass']);
assert.deepEqual(types(SEON, '불합격 나왔습니다 폐기 진행'), ['quarantine_fail']);
assert.deepEqual(types(SEON, '46-2차 태국\n오전 검역 진행했습니다\n46-2차 베트남 건은 오후 검역 진행됩니다'), ['quarantine_plan']);
assert.deepEqual(types(SEON, '상기건 내일 오전 검역입니다'), ['quarantine_plan']);
assert.deepEqual(types(SEON, '상기 건 서류 부탁 드립니다\n오후 검역 진행 하겠습니다'), ['docs_request', 'quarantine_plan']);
assert.deepEqual(types(SEON, '해당 비엘 번호 서류 보내주시면 될거 같습니다'), ['docs_request']);
assert.deepEqual(types(SEON, '(농장) 검역증 재발행본 나왔을까요?'), ['docs_request']);
assert.deepEqual(types(SEON, '아직 서류 전달받지 못 했습니다 명일 도착하는 태국, 네덜란드건 서류 받으면 바로 드리겠습니다.'), ['docs_pending_staff']);
assert.deepEqual(types(SEON, '보내주신 인보이스 검역증과 수량이 상이 합니다\n확인 부탁 드립니다'), ['qty_mismatch']);
assert.deepEqual(types(SEON, '검역증에 NON-LMO 부기가 없습니다\n별도로 시료 채취 예정이며 재발행 본 전달 바랍니다').sort(), ['docs_request', 'lmo']);
assert.deepEqual(types(SEON, '홀렉스-목화 (LMO 검사)'), ['lmo']);
assert.deepEqual(types(SEON, '태국 건 세관 검사 걸렸습니다\n9시 30분 진행 예정입니다'), ['customs_inspection']);
assert.deepEqual(types(SEON, '홀렉스-(에린지움-9박스), (수선-9박스)\n오후 소독 입니다'), ['fumigation']);
assert.deepEqual(types(SEON, '46-2차 수국\n스케줄 확인 부탁 드립니다\n홍콩에서 일부만 실린걸로 확인 됩니다'), ['partial_arrival']);
assert.deepEqual(types(SEON, '선소독 품목 없습니다'), [], '소독 없음은 사건 아님');
assert.deepEqual(types(SEON, '오전검역 신청은 오전9시까지입니다'), ['quarantine_plan']);

// 빌번호방 틀
assert.deepEqual(types(AWB, '* 네노바\n999-99999999 / 999CT\n빌 뒤 파우치 없습니다'), ['manifest_qty']);
assert.deepEqual(types(AWB, '999-99999999 물건 확인되었습니다. 전산 반입은 아직입니다.'), ['warehoused']);
assert.deepEqual(types(AWB, '오늘 반입 된거네요'), ['warehoused']);
assert.deepEqual(types(AWB, 'K9999편기_ 네노바\n999-99999999 / 9,999CT\n=> 999CT만 입항으로 스케줄 확인.\n=> 잔량스케줄 9일(오늘) K9999 99:99 예정입니다'), ['manifest_qty', 'partial_arrival']);
assert.deepEqual(types(AWB, '금일 오후 소독건입니다\n9PLT 99box'), ['fumigation']);
assert.deepEqual(types(AWB, '넵 입항이 늦어진것으로 보입니다. 오후검역 진행 예정입니다'), ['arrival_late', 'quarantine_plan']);
assert.deepEqual(types(AWB, '이건 작업이 너무 안 돼서 내일 오전에 입고 될것 같습니다'), ['arrival_late']);
assert.deepEqual(types(AWB, '네. 중국 B차 세관검사 입니다.'), ['customs_inspection']);
assert.deepEqual(types(AWB, '금일 반출신고 된건이고 추가 서류 들어왔다고 하는데 혹시 필요하실까요?'), ['released']);
// 방 제한: 합격은 선율방 글만, 반입은 빌번호방 글만
assert.deepEqual(types(AWB, '합격 나왔습니다'), []);
assert.deepEqual(types(SEON, '오늘 반입 된거네요'), []);
// 스케줄방 글·도착 공지 글 제외
assert.deepEqual(types('스케줄방', '합격 나왔습니다'), []);
assert.deepEqual(types(SEON, '46-2차 태국 (KOREAN AIR)\n11월 17일 (화) 06:55 도착 예정\n(180-12345686 KE652 10 BOX)\n합격'), ['quarantine_pass']);

// 필드
const ev = extractRoomEvents([msg(SEON, '2026-11-16T05:00:00Z', '46-2차 카장\n999-99999999 합격 나왔습니다\nB 차는 확인 중')])[0];
assert.equal(ev.room, SEON);
assert.equal(ev.roomShort, '선율');
assert.deepEqual(ev.awbs, ['99999999999']);
assert.deepEqual(ev.weekLabels, ['46-2']);
assert.deepEqual(ev.countries, ['콜롬비아']);
assert.equal(ev.subHint, 'b');
assert.ok(ev.text.includes(' / ') && !ev.text.includes('\n'));
assert.equal(extractRoomEvents([msg(SEON, '2026-11-16T05:00:00Z', `합격 ${'가'.repeat(300)}`)])[0].text.length, 140);
assert.equal(extractRoomEvents([msg(SEON, '2026-11-16T05:00:00Z', '중국 A차 합격\nB차 합격')])[0].subHint, '', 'A·B 둘 다면 힌트 없음');
// 시간 오름차순
const two = extractRoomEvents([msg(SEON, '2026-11-16T06:00:00Z', '합격'), msg(SEON, '2026-11-16T05:00:00Z', '합격')]);
assert.ok(Date.parse(two[0].at) < Date.parse(two[1].at));

// 연결
const K = (s) => new Date(`${s}:00+09:00`).toISOString();
const flights = [
  { key: '180-12345697', awb: '180-12345697', weekLabel: '46-2a', country: '네덜란드', arriveAt: K('2026-11-17T16:50'), noticeMessageIds: ['N1'] },
  { key: '999-12345675', awb: '999-12345675', weekLabel: '46-2b', country: '중국', arriveAt: K('2026-11-17T08:00'), noticeMessageIds: [] },
  { key: '999-12345683', awb: '999-12345683', weekLabel: '46-2a', country: '중국', arriveAt: K('2026-11-16T08:00'), noticeMessageIds: [] },
  { key: '014-12345675', awb: '014-12345675', weekLabel: '46-3', country: '콜롬비아', arriveAt: K('2026-11-20T10:00'), noticeMessageIds: [] },
];
const mk = (room, kst, message, id) => ({ chatroom: room, sender: 's', message, created_at: K(kst), external_message_id: id || `x${++seq}` });
const link = (msgs, opts = {}) => {
  const out = linkRoomEvents(extractRoomEvents(msgs), flights, { now: Date.parse(K('2026-11-17T12:00')), messages: msgs, ...opts });
  return out;
};
const one = (out, key) => (out.byFlight.get(key) || []);

// 1. 운송장
let o = link([mk(AWB, '2026-11-17T09:00', '180-12345697 / 57CT\n수량 맞습니다')]);
assert.equal(one(o, '180-12345697')[0].link, 'awb');
assert.equal(one(o, '180-12345697')[0].guessed, false);
// 2. 차수: 글자 없는 차수는 a·b 모두, 글자 있으면 그 편만, 나라 있으면 나라까지
o = link([mk(SEON, '2026-11-17T09:00', '46-2차 합격 나왔습니다')]);
assert.equal(one(o, '180-12345697').length, 1);
assert.equal(one(o, '999-12345675').length, 1);
assert.equal(one(o, '999-12345683').length, 1);
assert.equal(one(o, '180-12345697')[0].link, 'ambiguous');
o = link([mk(SEON, '2026-11-17T09:00', '46-2차 중국 합격 나왔습니다')]);
assert.equal(one(o, '180-12345697').length, 0, '나라가 다르면 안 붙음');
assert.equal(one(o, '999-12345675').length, 1);
o = link([mk(SEON, '2026-11-17T09:00', '46-2b차 합격 나왔습니다')]);
assert.deepEqual([...o.byFlight.keys()], ['999-12345675']);
// 3. 나라 + 시간창, A차/B차 힌트
o = link([mk(SEON, '2026-11-17T09:00', '중국 건 합격 나왔습니다')]);
assert.equal(one(o, '999-12345675')[0].link, 'country');
assert.equal(one(o, '999-12345675')[0].guessed, true);
assert.equal(one(o, '999-12345683').length, 0, '글 시각에 가장 가까운 편 1개(08:00 이 16시간 전 편보다 가깝다)');
o = link([mk(SEON, '2026-11-17T09:00', '중국 A차는 합격')]);
assert.equal(one(o, '999-12345683').length, 1, 'A차 힌트면 끝 글자 a 편 우선');
assert.equal(one(o, '999-12345675').length, 0);
o = link([mk(SEON, '2026-11-20T09:00', '중국 합격 나왔습니다')]);
assert.equal(o.unlinked.length, 1, '시간창(−36h~+72h) 밖이면 붙이지 않음');
// 4. 앞 글에 이어진 답글: 공지 글 뒤
const notice = { ...mk(SEON, '2026-11-17T09:00', '공지', 'N1') };
o = link([notice, mk(SEON, '2026-11-17T09:20', '상기 건 서류 부탁 드립니다')]);
assert.equal(one(o, '180-12345697')[0].link, 'thread');
assert.equal(one(o, '180-12345697')[0].guessed, true);
// 앞 사건 글 뒤(체인), 60분 넘으면 끊김, 다른 방은 이어지지 않음
o = link([mk(AWB, '2026-11-17T09:00', '180-12345697 / 57CT'), mk(AWB, '2026-11-17T09:30', '오늘 반입 된거네요')]);
assert.equal(one(o, '180-12345697').length, 2);
assert.equal(one(o, '180-12345697')[1].link, 'thread');
o = link([mk(AWB, '2026-11-17T09:00', '180-12345697 / 57CT'), mk(AWB, '2026-11-17T10:30', '오늘 반입 된거네요')]);
assert.equal(o.unlinked.length, 1);
o = link([mk(AWB, '2026-11-17T09:00', '180-12345697 / 57CT'), mk(SEON, '2026-11-17T09:10', '상기 건 합격 나왔습니다')]);
assert.equal(o.unlinked.length, 1);
// 5. 못 붙임
o = link([mk(SEON, '2026-11-17T09:00', '합격 나왔습니다')]);
assert.equal(o.byFlight.size, 0);
assert.equal(o.unlinked.length, 1);
// 위 규칙 우선순위: 운송장이 차수·나라보다 먼저
o = link([mk(AWB, '2026-11-17T09:00', '46-2차 중국 180-12345697 / 57CT')]);
assert.equal(one(o, '180-12345697')[0].link, 'awb');

// 도착한 뒤에만 생기는 글(소독)은 아직 도착하지 않은 편에 추정으로 붙이지 않는다
{
  const fl = [{ key: 'F1', awb: '992-12345675', weekLabel: '47-1', country: '콜롬비아', arriveAt: '2026-11-18T17:10:00+09:00', noticeMessageIds: ['n1'] }];
  const msgs = [
    { chatroom: '빌번호방', sender: 'a', message: 'x', created_at: '2026-11-17T01:20:00Z', external_message_id: 'n1' },
    { chatroom: '빌번호방', sender: 'b', message: '금일 소독건입니다' + String.fromCharCode(10) + '2PLT 53box', created_at: '2026-11-17T01:54:00Z', external_message_id: 'e1' },
  ];
  const evs = extractRoomEvents([msgs[1]]);
  const r = linkRoomEvents(evs, fl, { now: Date.parse('2026-11-17T12:00:00+09:00'), messages: msgs });
  assert.equal(r.byFlight.size, 0, '내일 도착할 편에 오늘 소독 글을 붙이지 않는다');
  assert.equal(r.unlinked.length, evs.length);
}

console.log('importRoomEvents tests passed');
