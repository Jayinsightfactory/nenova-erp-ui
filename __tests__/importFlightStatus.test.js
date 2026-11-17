import assert from 'node:assert/strict';
import {
  AIRPORTS, TRANSIT, originFor, greatCircleKm, greatCirclePoint, routePoints,
  classifyFlight, externalLinks, airlineName, AWB_PREFIX_AIRLINE,
} from '../lib/importFlightStatus.js';
import { planRoute, LAYOVER_HOURS_ASSUMED } from '../lib/importFlightStatus.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// 출발지
assert.deepEqual(originFor({ country: '콜롬비아', itemLabel: '콜카장수국' }), { code: 'BOG', assumed: false });
assert.deepEqual(originFor({ country: '콜롬비아', itemLabel: '콜수국' }), { code: 'MDE', assumed: false });
assert.deepEqual(originFor({ country: '콜롬비아', itemLabel: '수국' }), { code: 'MDE', assumed: false });
assert.deepEqual(originFor({ country: '콜롬비아', itemLabel: '' }), { code: 'BOG', assumed: false });
assert.deepEqual(originFor({ country: '에콰도르' }), { code: 'UIO', assumed: false });
assert.deepEqual(originFor({ country: '네덜란드' }), { code: 'AMS', assumed: false });
assert.deepEqual(originFor({ country: '태국' }), { code: 'BKK', assumed: false });
for (const [c, code] of [['중국', 'KMG'], ['호주', 'SYD'], ['미국', 'LAX'], ['베트남', 'SGN'], ['뉴질랜드', 'AKL']]) {
  assert.deepEqual(originFor({ country: c }), { code, assumed: true });
}
assert.equal(originFor({ country: '기타' }), null);
assert.equal(TRANSIT.콜롬비아.hours, 52); assert.equal(TRANSIT.에콰도르.via, true);

// 대권
const p0 = greatCirclePoint(AIRPORTS.BOG, AIRPORTS.ICN, 0);
const p1 = greatCirclePoint(AIRPORTS.BOG, AIRPORTS.ICN, 1);
near(p0.lat, AIRPORTS.BOG.lat); near(p0.lon, AIRPORTS.BOG.lon);
near(p1.lat, AIRPORTS.ICN.lat); near(p1.lon, AIRPORTS.ICN.lon);
const ams = greatCircleKm(AIRPORTS.AMS, AIRPORTS.ICN);
assert.ok(Math.abs(ams - 8500) <= 300, String(ams));
const mid = greatCirclePoint(AIRPORTS.AMS, AIRPORTS.ICN, 0.5);
near(greatCircleKm(AIRPORTS.AMS, mid), ams / 2, 1);
const rp = routePoints(AIRPORTS.AMS, AIRPORTS.ICN);
assert.equal(rp.length, 49); near(rp[0].lat, AIRPORTS.AMS.lat);

// 상태 분류 (네덜란드: 직항 소요시간 = 거리/820+1)
const hoursNL = ams / 820 + 1;
const arrive = '2026-11-15T16:55:00+09:00';
const arriveMs = Date.parse(arrive);
const nl = { country: '네덜란드', itemLabel: '네덜란드 홀렉스', awb: '18012345675', arrivalAt: arrive, arrivalDate: '2026-11-15', flight: 'KE0926' };
const at = (ms) => new Date(ms).toISOString();

let c = classifyFlight(nl, { now: at(arriveMs - (hoursNL + 5) * 3600e3), receipt: null });
assert.equal(c.status, 'before_departure'); assert.equal(c.statusLabel, '출발 전(예측)'); assert.equal(c.progress, 0);
assert.equal(c.predicted, true); assert.equal(c.note, '일정으로 계산한 예측');
near(Date.parse(c.departAtEstimated), arriveMs - hoursNL * 3600e3, 1000);

c = classifyFlight(nl, { now: at(arriveMs - (hoursNL / 2) * 3600e3), receipt: null });
assert.equal(c.status, 'in_flight'); assert.equal(c.statusLabel, '비행 중(예측)');
near(c.progress, 0.5, 1e-3);
assert.ok(c.position && greatCircleKm(c.position, mid) < 20);
assert.equal(c.origin.code, 'AMS');

c = classifyFlight(nl, { now: at(arriveMs + 3600e3), receipt: null });
assert.equal(c.status, 'arrived'); assert.equal(c.statusLabel, '도착(예정 시각 지남)'); assert.equal(c.progress, 1);
assert.equal(c.position.lat, AIRPORTS.ICN.lat); assert.deepEqual(c.issues, []);

c = classifyFlight(nl, { now: at(arriveMs + 31 * 3600e3), receipt: null });
assert.deepEqual(c.issues, ['도착 예정 시각이 30시간 넘게 지났는데 입고 등록이 없음']);
c = classifyFlight(nl, { now: at(arriveMs + 29 * 3600e3), receipt: null });
assert.deepEqual(c.issues, []);
c = classifyFlight(nl, { now: at(arriveMs + 31 * 3600e3), receipt: { registeredAt: at(arriveMs + 3600e3), masters: 1, farms: 1, boxes: 10 } });
assert.equal(c.status, 'registered'); assert.equal(c.statusLabel, '입고 등록 끝'); assert.equal(c.progress, 1); assert.deepEqual(c.issues, []);

c = classifyFlight({ ...nl, awb: '' }, { now: at(arriveMs - 3600e3), receipt: null });
assert.equal(c.status, 'awaiting_awb'); assert.equal(c.statusLabel, '빌번호 대기'); assert.equal(c.progress, null);

// 경유 노선 note, 시각 가정
const col = { country: '콜롬비아', itemLabel: '콜카장수국', awb: '16012345675', arrivalAt: null, arrivalDate: '2026-11-12' };
c = classifyFlight(col, { now: '2026-11-12T00:00:00+09:00', receipt: null });
assert.equal(c.timeAssumed, true); assert.equal(c.note, '경유지 미확인 — 위치는 일정으로 계산한 예측');
assert.equal(c.arriveAt, '2026-11-12T03:00:00.000Z');
assert.equal(c.status, 'in_flight');

// 링크
assert.deepEqual(externalLinks({ flight: 'KE0926', awb: '18012345675' }), {
  flightTrack: 'https://www.flightradar24.com/data/flights/ke926',
  flightSearch: 'https://www.google.com/search?q=KE0926',
});
assert.equal(externalLinks({ flight: 'M76318' }).flightTrack, 'https://www.flightradar24.com/data/flights/m76318');
assert.deepEqual(externalLinks({ flight: '' }), { flightTrack: null, flightSearch: null });
assert.ok(!JSON.stringify(externalLinks({ flight: 'KE0926', awb: '18012345675' })).includes('12345675'));

// 항공사
assert.equal(airlineName({ airlineText: 'Korean Air', awb: '99912345675' }), 'Korean Air');
assert.equal(airlineName({ airlineText: '', awb: '18012345675' }), '대한항공');
assert.equal(airlineName({ awb: '' }), '');
assert.equal(AWB_PREFIX_AIRLINE['160'], '캐세이퍼시픽');

// ── 경유 노선: 공항 자료(인천행 마지막 비행기의 출발 공항·도착 시각)로 출발지 → 경유지 → 인천 두 구간 ──
{
  const fl = { country: '콜롬비아', itemLabel: '콜카장수국', awb: '01412345675' };
  const icn = { airportCode: 'YVR', scheduledAt: '2026-11-18T17:10:00+09:00', estimatedAt: '2026-11-18T17:10:00+09:00' };
  const at = (iso) => planRoute(fl, { now: Date.parse(iso), icn });
  const lay = at('2026-11-18T03:00:00+09:00');
  assert.equal(lay.via.code, 'YVR');
  assert.equal(lay.via.name, '밴쿠버');
  assert.equal(lay.phase, 'layover', '마지막 비행기 출발 전이고 첫 구간 도착 뒤 → 경유지 대기');
  assert.equal(lay.status, 'in_flight');
  assert.ok(/밴쿠버 경유지 대기/.test(lay.statusLabel));
  assert.ok(Math.abs(lay.position.lat - 49.1947) < 0.01, '위치는 경유지');
  assert.ok(lay.progress > 0.3 && lay.progress < 0.6, '전체 거리 중 첫 구간 비율');
  const leg2 = at('2026-11-18T12:00:00+09:00');
  assert.equal(leg2.phase, 'leg2');
  assert.ok(/밴쿠버 → 인천 비행 중/.test(leg2.statusLabel));
  assert.ok(leg2.progress > lay.progress && leg2.progress < 1);
  const leg1 = at('2026-11-17T20:00:00+09:00');
  assert.equal(leg1.phase, 'leg1');
  assert.ok(leg1.progress > 0 && leg1.progress < lay.progress);
  assert.equal(at('2026-11-15T00:00:00+09:00').phase, 'before_departure');
  // 도착이 미뤄진 편은 마지막 비행기가 뜨기 전이면 경유지 대기로 본다
  assert.equal(planRoute(fl, { now: Date.parse('2026-11-17T12:00:00+09:00'), icn, delayed: true }).phase, 'layover');
  assert.equal(planRoute(fl, { now: Date.parse('2026-11-18T12:00:00+09:00'), icn, delayed: true }).phase, 'leg2');
  assert.equal(at('2026-11-18T18:00:00+09:00').phase, 'arrived');
  assert.ok(lay.route.length > 30, '출발지→경유지→인천 경로 점');
  assert.ok(Date.parse(lay.lastLegDepartAt) < Date.parse(icn.estimatedAt));
  assert.equal(LAYOVER_HOURS_ASSUMED, 6);
  // 직항(출발 공항이 같음)·공항 자료 없음·모르는 공항 코드는 경유 계산을 하지 않는다
  assert.equal(planRoute({ country: '네덜란드', itemLabel: '홀렉스', awb: '18012345675' }, { now: Date.now(), icn: { airportCode: 'AMS', estimatedAt: '2026-11-18T16:50:00+09:00' } }), null);
  assert.equal(planRoute(fl, { now: Date.now(), icn: null }), null);
  assert.equal(planRoute(fl, { now: Date.now(), icn: { airportCode: 'ZZZ', estimatedAt: '2026-11-18T16:50:00+09:00' } }), null);
}

console.log('importFlightStatus tests passed');
