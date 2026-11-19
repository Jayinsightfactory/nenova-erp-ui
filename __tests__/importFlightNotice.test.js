import assert from 'node:assert/strict';
import {
  IMPORT_SCHEDULE_ROOMS, normalizeAwb, formatAwb, awbCheckOk,
  parseFlightNoticeMessage, mergeFlightNotices,
} from '../lib/importFlightNotice.js';

const NOW = '2026-11-10T00:00:00Z';
const m = (message, created_at, chatroom = '스케줄방', id = 'x') => ({ chatroom, sender: 's', message, created_at, external_message_id: id });

const T1 = `< 46-1 콜롬비아 최종 스케줄 >
＊수요일＊
46-1차 콜카장수국 (MAS AIR)
11월 11일(수) 14:35 도착 예정
(86512345675 M76318 1042 BOX)
카네이션: 400 박스
장미: 380 박스
수국: 200 박스
알스트로: 50 박스
루스쿠스: 12 박스
총: 1,042 박스`;
const T2 = `목요일
46-2차 태국 (KOREAN AIR)
11월 12일 (목) 06:55 도착 예정
(180-12345675 KE652 10 BOX)
[46-2차 네덜란드 홀렉스] (Korean Air)
11월 15일 (일) 오후 4시 55분 도착 예정
(180-  KE0926 _ box)
기타정보 및 서류는 확인되는대로 공유드리겠습니다`;
const T3 = `< 중국 스케줄 공유 >
＊일요일＊
46-2a차 중국 (XIAMEN AIRLINES)
11월 15일(일) 도착 예정 시간 확인 필요
(731-12345675 MF871 120 BOX)`;
const T4 = `<네덜란드 AWB>
46-2차 네덜란드 홀렉스(Korean Air)
11월 15일 (일) 오후 4시 55분 도착 예정
AWB 180-1234-5686`;
const T5 = `** 46-1차 콜카장 도착 지연**
(MDE-MIA 연결편 지연으로 재예약)
< 콜롬비아 스케줄 변경 >
＊목요일＊
46-1차 콜카장 (CATHAY)
11월 12일(목) 21:10 도착 예정
(AWB 160-12345675 편명 CX416 880 BOX)`;

// 운송장 유틸
assert.deepEqual(IMPORT_SCHEDULE_ROOMS, ['스케줄방', '빌번호방', '네노바&선율방']);
assert.equal(normalizeAwb('180-1234-5675'), '18012345675');
assert.equal(normalizeAwb('180-12345675'), '18012345675');
assert.equal(normalizeAwb('123'), '');
assert.equal(formatAwb('18012345675'), '180-12345675');
assert.equal(awbCheckOk('18012345675'), true);
assert.equal(awbCheckOk('18012345676'), false);

// 글 1
let r = parseFlightNoticeMessage(m(T1, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r.length, 1);
assert.equal(r[0].weekLabel, '46-1'); assert.equal(r[0].weekMajor, 46); assert.equal(r[0].subWeek, '1');
assert.equal(r[0].country, '콜롬비아'); assert.equal(r[0].itemLabel, '콜카장수국');
assert.equal(r[0].airlineText, 'MAS AIR'); assert.equal(r[0].awb, '86512345675');
assert.equal(r[0].flight, 'M76318'); assert.equal(r[0].box, 1042);
assert.equal(r[0].arrivalDate, '2026-11-11'); assert.equal(r[0].arrivalTime, '14:35');
assert.equal(r[0].arrivalAt, '2026-11-11T14:35:00+09:00');
assert.equal(r[0].items.length, 5); assert.deepEqual(r[0].items[0], { name: '카네이션', box: 400 });
assert.equal(r[0].isChangeNotice, false); assert.equal(r[0].room, '스케줄방');

// 글 2: 두 편, 오후 시각, _ box, 불완전 운송장
r = parseFlightNoticeMessage(m(T2, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r.length, 2);
assert.equal(r[0].country, '태국'); assert.equal(r[0].awb, '18012345675'); assert.equal(r[0].flight, 'KE652'); assert.equal(r[0].box, 10);
assert.equal(r[1].country, '네덜란드'); assert.equal(r[1].awb, ''); assert.equal(r[1].flight, 'KE0926'); assert.equal(r[1].box, null);
assert.equal(r[1].arrivalTime, '16:55'); assert.equal(r[1].arrivalAt, '2026-11-15T16:55:00+09:00');
assert.equal(r[1].airlineText, 'Korean Air');

// 글 3: 중국, 2a, 시각 없음
r = parseFlightNoticeMessage(m(T3, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r.length, 1); assert.equal(r[0].country, '중국'); assert.equal(r[0].subWeek, '2a');
assert.equal(r[0].weekLabel, '46-2a'); assert.equal(r[0].arrivalAt, null); assert.equal(r[0].arrivalTime, '');
assert.equal(r[0].awb, '73112345675'); assert.equal(r[0].flight, 'MF871'); assert.equal(r[0].box, 120);

// 글 4: AWB 줄, 하이픈 3-4-4
r = parseFlightNoticeMessage(m(T4, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r.length, 1); assert.equal(r[0].awb, "18012345686"); assert.equal(r[0].flight, ""); assert.equal(r[0].box, null);

// 글 5: 변경 공지
r = parseFlightNoticeMessage(m(T5, '2026-11-10T01:00:00Z'), { now: NOW });
assert.equal(r.length, 1); assert.equal(r[0].isChangeNotice, true);
assert.ok(r[0].changeReason.length > 0 && r[0].changeReason.length <= 80);
assert.equal(r[0].awb, '16012345675'); assert.equal(r[0].flight, 'CX416'); assert.equal(r[0].box, 880);

// 편명 K4914, 차 없음 머리줄, 오전 시각
r = parseFlightNoticeMessage(m(`46-1 중국 CLOUD (CLOUD AIR)
11월 13일 오전 9시 30분 도착 예정
(99912345675 K4914 5 BOX)
총: 5 박스`, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r[0].country, '중국'); assert.equal(r[0].flight, 'K4914'); assert.equal(r[0].arrivalTime, '09:30'); assert.equal(r[0].box, 5);
r = parseFlightNoticeMessage(m(`46-1차 호주 (QANTAS)
11월 13일 오후 4시 도착 예정
(O3123 _ box)
총: 7 박스`, '2026-11-09T01:00:00Z'), { now: NOW });
assert.equal(r[0].arrivalTime, '16:00'); assert.equal(r[0].flight, 'O3123'); assert.equal(r[0].box, 7); assert.equal(r[0].country, '호주');

// 도착 예정 없는 구획·머리줄 없는 글은 버린다
assert.equal(parseFlightNoticeMessage(m('46-1차 콜카장 도착 지연', '2026-11-09T01:00:00Z'), { now: NOW }).length, 0);
assert.equal(parseFlightNoticeMessage(m('11월 11일(수) 14:35 도착 예정', '2026-11-09T01:00:00Z'), { now: NOW }).length, 0);

// 연말 넘김
r = parseFlightNoticeMessage(m(`52-2차 태국 (KE)
1월 2일(금) 07:00 도착 예정
(180-12345675 KE652 3 BOX)`, '2026-12-30T03:00:00Z'), { now: NOW });
assert.equal(r[0].arrivalDate, '2027-01-02');
r = parseFlightNoticeMessage(m(`1-1차 태국 (KE)
12월 29일 07:00 도착 예정`, '2027-01-03T03:00:00Z'), { now: NOW });
assert.equal(r[0].arrivalDate, '2026-12-29');
r = parseFlightNoticeMessage(m(`1-1차 태국 (KE)
1월 1일 07:00 도착 예정`, '2026-12-31T16:00:00Z'), { now: NOW });
assert.equal(r[0].arrivalDate, '2027-01-01');

// 병합: 사전 공지(운송장 없음)가 나중 공지에 흡수 + 도착 변경·박스 변경
const pre = m(`46-1차 콜카장 (CATHAY)
11월 11일(수) 14:35 도착 예정
(160-  CX416 1,042 BOX)`, '2026-11-08T01:00:00Z', '스케줄방', 'a');
const later = m(T5, '2026-11-10T01:00:00Z', '스케줄방', 'b');
let mg = mergeFlightNotices([later, pre], { now: NOW });
assert.equal(mg.length, 1);
assert.equal(mg[0].mentions, 2); assert.equal(mg[0].awb, '16012345675');
assert.ok(mg[0].issues.includes('도착 변경: 11/11 14:35 → 11/12 21:10'), mg[0].issues.join('|'));
assert.ok(mg[0].issues.includes('박스 수 변경: 1,042 → 880'));
assert.ok(mg[0].issues.some((s) => s.startsWith('지연·변경 공지: ')));
assert.ok(mg[0].issues.some((s) => s.startsWith('변경 공지가 일부 방에만 올라옴(올라온 방: 스케줄방')));
assert.equal(mg[0].history.length, 2);
assert.equal(mg[0].firstPostedAt, '2026-11-08T01:00:00Z'); assert.equal(mg[0].lastPostedAt, '2026-11-10T01:00:00Z');
assert.equal(mg[0].arrivalAt, '2026-11-12T21:10:00+09:00');

// 변경 공지가 3개 방 모두에 올라오면 일부 방 이슈 없음, rooms 중복 제거
mg = mergeFlightNotices([
  m(T5, '2026-11-10T01:00:00Z', '스케줄방', 'c1'),
  m(T5, '2026-11-10T01:01:00Z', '빌번호방', 'c2'),
  m(T5, '2026-11-10T01:02:00Z', '네노바&선율방', 'c3'),
  m(T5, '2026-11-10T01:03:00Z', '스케줄방', 'c4'),
], { now: NOW });
assert.equal(mg.length, 1); assert.equal(mg[0].mentions, 4); assert.equal(mg[0].rooms.length, 3);
assert.ok(!mg[0].issues.some((s) => s.includes('일부 방에만')));
assert.equal(mg[0].history.length, 1);

// 여러 글 병합: 정렬·이슈
mg = mergeFlightNotices([
  m(T1, '2026-11-09T01:00:00Z', '스케줄방', '1'), m(T2, '2026-11-09T01:00:00Z', '스케줄방', '2'),
  m(T3, '2026-11-09T01:00:00Z', '스케줄방', '3'), m(T4, '2026-11-09T05:00:00Z', '빌번호방', '4'),
], { now: NOW });
assert.equal(mg.length, 4);
const nl = mg.find((x) => x.country === '네덜란드');
assert.equal(nl.awb, "18012345686"); assert.equal(nl.flight, 'KE0926'); assert.equal(nl.mentions, 2);
assert.equal(nl.rooms.length, 2); assert.ok(!nl.issues.includes('편명 아직 없음'));
const cn = mg.find((x) => x.country === '중국');
assert.ok(cn.issues.includes('도착 시각 미정'));
const ts = mg.map((x) => Date.parse(x.arrivalAt || `${x.arrivalDate}T12:00:00+09:00`));
assert.deepEqual(ts, [...ts].sort((a, b) => a - b));

// 검산 불일치
mg = mergeFlightNotices([m(`46-1차 태국 (KE)
11월 12일 06:55 도착 예정
(180-12345676 KE652 10 BOX)`, '2026-11-09T01:00:00Z')], { now: NOW });
assert.ok(mg[0].issues.includes('빌번호 확인 필요(검산 불일치)'));
// 운송장 없음 / 편명 없음
mg = mergeFlightNotices([m(`46-2차 네덜란드 홀렉스 (Korean Air)
11월 15일 오후 4시 55분 도착 예정
(180-  KE0926 _ box)`, '2026-11-09T01:00:00Z')], { now: NOW });
assert.ok(mg[0].issues.includes('빌번호 아직 없음'));
mg = mergeFlightNotices([m(T4, '2026-11-09T01:00:00Z')], { now: NOW });
assert.ok(mg[0].issues.includes('편명 아직 없음'));

// ── 실제 방에서 나온 글 모양(2026-11 수집분, 번호는 지어낸 값) ──
// 괄호·AWB 낱말 없이 번호만 적힌 줄
let rx = parseFlightNoticeMessage(m('* 46-1차 베트남*\n11월 11일 (수) 오전 06:30 도착 예정\n73812345675 6BOX\n서류는 확인되는대로 공유드리겠습니다', '2026-11-10T02:00:00Z'), { now: NOW });
assert.equal(rx.length, 1);
assert.equal(rx[0].awb, '73812345675');
assert.equal(rx[0].box, 6);
assert.equal(rx[0].arrivalTime, '06:30');
assert.equal(rx[0].country, '베트남');
// 번호를 3-4 4 로 띄어 쓴 모양 + 번호 매긴 머리줄
rx = parseFlightNoticeMessage(m('중국 44-2차 스케줄 정리\n1. 44-2B 중국\n11월 2일 월요일 오후 12시 55분 도착예정\n999-1234 5675  CA401 88BOX\n2. 44-2A 중국\n11월 3일 화요일 오전 08시 50분 도착예정\n999-1234 5686  O3141  112BOX', '2026-11-01T02:00:00Z'), { now: NOW });
assert.equal(rx.length, 2);
assert.deepEqual(rx.map(f => f.weekLabel), ['44-2b', '44-2a']);
assert.deepEqual(rx.map(f => f.awb), ['99912345675', '99912345686']);
assert.deepEqual(rx.map(f => f.flight), ['CA401', 'O3141']);
assert.deepEqual(rx.map(f => f.arrivalTime), ['12:55', '08:50']);
// "내일" 같은 상대 날짜는 게시일(한국 날짜) 기준
rx = parseFlightNoticeMessage(m('* 화요일 *\n46-3차 중국\n내일 (화) 오전 8시 30분 도착 예정\n921-12345675 ', '2026-11-09T06:00:00Z'), { now: NOW });
assert.equal(rx.length, 1);
assert.equal(rx[0].arrivalDate, '2026-11-10');
assert.equal(rx[0].arrivalTime, '08:30');
assert.equal(rx[0].awb, '92112345675');
// 두 차수를 한 머리줄에 적은 사전 공지
rx = parseFlightNoticeMessage(m('<중국 스케줄 > \n* 일요일 *\n45-3A, 45-3B차 중국 CLOUD\n11월 7일 (일)  오후 8시 50분 도착 예정 (A, B 모두)', '2026-11-06T06:00:00Z'), { now: NOW });
assert.equal(rx.length, 1);
assert.equal(rx[0].weekLabel, '45-3a');
assert.equal(rx[0].itemLabel, '중국 CLOUD');
assert.equal(rx[0].arrivalTime, '20:50');
// 머리줄·도착·번호를 한 줄에 다 적은 공지
rx = parseFlightNoticeMessage(m('<42주차 에콰도르 스케줄 > \n＊수요일＊ \n42-1차 에콰도르 (DELTA AIR LINES) 10월 21일(수) 04:15 도착 예정 (006-12345675 DL0027 10 BOX)', '2026-10-19T06:00:00Z'), { now: NOW });
assert.equal(rx.length, 1);
assert.equal(rx[0].country, '에콰도르');
assert.equal(rx[0].airlineText, 'DELTA AIR LINES');
assert.equal(rx[0].arrivalAt, '2026-10-21T04:15:00+09:00');
assert.equal(rx[0].awb, '00612345675');
assert.equal(rx[0].flight, 'DL0027');
assert.equal(rx[0].box, 10);
// 사전 공지 "46-2" 는 나중의 "46-2a" 운송장 공지에 합쳐진다
let mw = mergeFlightNotices([
  m('46-2 중국 CLOUD\n11월 15일 (일) 오전 8시 10분 도착 예정', '2026-11-13T01:00:00Z'),
  m('46-2a차 중국 CLOUD (XIAMEN AIRLINES)\n11월 15일(일) 08:10 도착 예정\n(731-12345675 MF871 120 BOX)', '2026-11-14T01:00:00Z'),
], { now: NOW });
assert.equal(mw.length, 1);
assert.equal(mw[0].awb, '73112345675');
assert.equal(mw[0].mentions, 2);
// 도착 공지가 아닌 대화 글은 편으로 읽지 않는다
assert.equal(parseFlightNoticeMessage(m('스케줄 조회가 안되는데 혹시 해당건 도착예정 편기가 뭔지 알 수 있을까요?', '2026-11-10T02:00:00Z'), { now: NOW }).length, 0);

console.log('importFlightNotice tests passed');


{
  const before = m('47차 미국\nETA 11월 19일 오전 4시 도착 예정\nKE048 18012345675 170박스', '2026-11-17T13:38:00Z');
  const after = m('47-1차 미국\n11월 19일 05:20 도착 예정\n(180-12345675 KE048 170 BOX)', '2026-11-18T04:35:00Z');
  const only = mergeFlightNotices([before], { now: NOW });
  assert.equal(only.length, 1);
  assert.equal(only[0].flight, 'KE048');
  assert.equal(only[0].weekMajor, 47);
  assert.equal(only[0].weekLabel, '');
  assert.equal(only[0].arrivalAt, '2026-11-19T04:00:00+09:00');
  const same = mergeFlightNotices([after, before], { now: NOW });
  assert.equal(same.length, 1);
  assert.equal(same[0].weekLabel, '47-1');
  assert.equal(same[0].arrivalAt, '2026-11-19T05:20:00+09:00');
  assert.equal(same[0].history.length, 2);
  for (const early of [
    {...before, message: before.message.replace('KE048', 'KE049')},
    {...before, message: before.message.replace('11월 19일', '11월 20일')},
    {...before, message: before.message.replace('47차', '46차')},
  ]) {
    const different = mergeFlightNotices([early, after], { now: NOW });
    assert.equal(different.length, 1);
    assert.equal(different[0].history.length, 1);
  }
  for (const ambiguous of [
    {...before, timestamp_approximate: true},
    {...before, chatroom: '빌번호방'},
    {...before, message: before.message.replace('오전 4시 ', '')},
    {...before, message: before.message.replace('미국', '이번 건')},
    {...before, message: before.message.replace('도착 예정', '도착 예정 문의')},
    {...before, message: before.message.replace('18012345675 ', '')},
  ]) assert.equal(parseFlightNoticeMessage(ambiguous, { now: NOW }).length, 0);
}
