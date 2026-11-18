import assert from 'node:assert/strict';
import { buildFlightBoard } from '../lib/importFlightBoard.js';
import { extractRoomEvents, linkRoomEvents } from '../lib/importRoomEvents.js';
import { readIcnFlights, pickIcnRecord, _clearIcnCache } from '../lib/importFlightIcn.js';

// Production message shapes, synthetic AWBs/counts. No names or production text archive.
const rooms = ['스케줄방', '빌번호방', '네노바&선율방'];
const now = Date.parse('2026-11-18T14:30:00+09:00');
let seq = 0;
const msg = (room, time, message) => ({chatroom:room, created_at:`2026-11-${time}:00+09:00`, message, external_message_id:`fixture-${++seq}`});
const schedule = (day, time) => `46-2차 콜카장 (AIR CANADA)\n11월 18일 14:20 도착 예정\n(01412345675 AC063 60 BOX)\n＊수요일＊ 딜레이\n47-1차 콜수국 (KALITTA)\n11월 ${day}일 ${time} 도착 예정\n(99212345675 K4254 40 BOX)`;
const messages = [
  ...rooms.map(r=>msg(r,'16T10:00',schedule(17,'22:00'))),
  ...rooms.map(r=>msg(r,'17T10:15',schedule(18,'17:10'))),
  msg(rooms[2],'17T18:03','47-1차 콜수국\n인보이스 100개 - 검역증 130개\n검역증 보다 1박스(30개) 덜 들어오나요?'),
  msg(rooms[2],'18T12:23','현재 제가 서류받은 건은\n46-2차 콜카장\n47-1차 콜수국\n2건 입니다'),
  msg(rooms[1],'18T13:07','99212345675 / 40CT\n마스터건 맞으시죠? 또 하우스건으로 적하 떠있습니다.'),
];
const build = (extra=[], opts={}) => buildFlightBoard({messages:[...messages,...extra],now,...opts});
const target = b=>b.flights.find(f=>f.key==='99212345675');
const staleIcn = {scheduledAt:'2026-11-17T22:41:00+09:00',estimatedAt:'2026-11-17T22:41:00+09:00',remark:'도착'};
let f = target(build([], {icn:new Map([['K4254', staleIcn]])}));
assert.equal(f.actual,null);
assert.notEqual(f.status,'arrived');
assert.equal(f.checklist.quarantine.deadlineAt,'2026-11-19T09:00:00+09:00');
assert.equal(f.checklist.steps.find(s=>s.key==='docs').state,'done');
assert.ok(f.roomEvents.some(e=>e.type==='docs_received' && !e.guessed && e.messageId));
assert.deepEqual(f.alerts.map(a=>a.text.split(' (')[0]).sort(),['검역증·인보이스 수량 대조 필요','마스터·하우스 적하 구분 확인'].sort());
assert.ok(!f.issues.some(t=>/변경|딜레이|공유/.test(t)));
assert.ok(f.history.length >= 2);

// Receipt of documents does not prove quantities corrected; explicit correction does.
f=target(build([msg(rooms[2],'18T14:00','47-1차 콜수국 수량 정정 완료했습니다'),msg(rooms[1],'18T14:01','99212345675 적하 수정 완료했습니다')]));
assert.equal(f.alerts.length,0);
f=target(build([msg(rooms[2],'18T14:00','47-1차 콜수국 수량 수정 부탁드립니다')]));
assert.ok(f.alerts.some(a=>/수량 대조/.test(a.text)));
f=target(build([msg(rooms[2],'18T14:00','47-1차 콜수국 서류 재전달 부탁드립니다')]));
assert.equal(f.checklist.steps.find(s=>s.key==='docs').state,'late','new request reopens old completion');

// Repost without the keyword still proves current schedule shared.
f=target(build(rooms.map(r=>msg(r,'18T14:00',schedule(18,'18:10').replace('딜레이','')))));
assert.equal(f.currentRooms.length,3);
assert.ok(!f.alerts.some(a=>/공지/.test(a.text)));

const flights=[{key:'current',awb:'992-12345675',weekLabel:'47-1',itemLabel:'콜수국',country:'콜롬비아',arriveAt:'2026-11-18T17:10:00+09:00'},{key:'prior',awb:'992-12345686',weekLabel:'47-1',itemLabel:'콜수국',country:'콜롬비아',arriveAt:'2025-11-18T17:10:00+09:00'},{key:'roses',awb:'992-12345697',weekLabel:'47-1',itemLabel:'콜카장',country:'콜롬비아',arriveAt:'2026-11-18T17:10:00+09:00'}];
let linked=linkRoomEvents(extractRoomEvents([msg(rooms[2],'18T12:23','47-1차 콜수국 서류 받았습니다')]),flights);
assert.deepEqual([...linked.byFlight.keys()],['current'],'year and item scope preserved');
linked=linkRoomEvents(extractRoomEvents([msg(rooms[2],'18T12:23','99999999999 47-1차 콜수국 서류 받았습니다')]),flights);
assert.equal(linked.byFlight.size,0,'unknown explicit AWB never falls back to a different flight');

assert.equal(pickIcnRecord([{scheduleDatetime:'202611172241'}],'2026-11-18T17:10:00+09:00'),null);
_clearIcnCache();
const times=['2026-11-18T17:10:00+09:00','2026-11-19T17:10:00+09:00'];
const map=await readIcnFlights('fixture',times.map(arriveAt=>({flight:'K4254',arriveAt})),{fetchImpl:async()=>({ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:[{scheduleDatetime:'202611181710'},{scheduleDatetime:'202611191710'}]}}})})});
assert.notEqual(map.get(`K4254|${times[0]}`).scheduledAt,map.get(`K4254|${times[1]}`).scheduledAt);
assert.equal(map.has('K4254'),false,'no ambiguous flight-number alias');
console.log('importFlightResolution passed: completed/reopened, scope, current sharing, wrong operating day');
