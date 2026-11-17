// 도착 공지로 만든 편 목록의 현재 상태·예측 위치를 계산하는 순수 함수 모음. DB·네트워크·fs 없음.

export const AIRPORTS = {
  ICN: { name: '인천', lat: 37.4602, lon: 126.4407 },
  BOG: { name: '보고타', lat: 4.7016, lon: -74.1469 },
  MDE: { name: '메데진', lat: 6.1645, lon: -75.4231 },
  UIO: { name: '키토', lat: -0.1292, lon: -78.3575 },
  AMS: { name: '암스테르담', lat: 52.3105, lon: 4.7683 },
  BKK: { name: '방콕', lat: 13.69, lon: 100.7501 },
  KMG: { name: '쿤밍', lat: 25.1019, lon: 102.9292 },
  SYD: { name: '시드니', lat: -33.9399, lon: 151.1753 },
  LAX: { name: '로스앤젤레스', lat: 33.9416, lon: -118.4085 },
  SGN: { name: '호찌민', lat: 10.8188, lon: 106.652 },
  AKL: { name: '오클랜드', lat: -37.0082, lon: 174.785 },
};

export const TRANSIT = { 콜롬비아: { hours: 52, via: true }, 에콰도르: { hours: 48, via: true } };

export const AWB_PREFIX_AIRLINE = {
  '180': '대한항공', '160': '캐세이퍼시픽', '865': '마스에어', '014': '에어캐나다', '992': '에어인천',
  '006': '델타', '157': '카타르', '235': '터키', '217': '타이', '784': '중국남방', '112': '중국동방',
  '999': '중국국제', '731': '샤먼', '324': '산둥', '738': '베트남항공', '081': '콴타스·젯스타',
  '272': '칼리타', '406': 'UPS·폴라',
};

const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function greatCircleKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function greatCirclePoint(a, b, t) {
  const f1 = rad(a.lat), l1 = rad(a.lon), f2 = rad(b.lat), l2 = rad(b.lon);
  const d = greatCircleKm(a, b) / R_KM;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
  const z = A * Math.sin(f1) + B * Math.sin(f2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

// n 구간으로 나눈 n+1 개의 점
export function routePoints(a, b, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(greatCirclePoint(a, b, i / n));
  return pts;
}

export function originFor(flight) {
  const country = flight && flight.country;
  const label = String((flight && flight.itemLabel) || '');
  switch (country) {
    case '콜롬비아':
      return { code: /수국/.test(label) && !/카|장미|네이션/.test(label) ? 'MDE' : 'BOG', assumed: false };
    case '에콰도르': return { code: 'UIO', assumed: false };
    case '네덜란드': return { code: 'AMS', assumed: false };
    case '태국': return { code: 'BKK', assumed: false };
    case '중국': return { code: 'KMG', assumed: true };
    case '호주': return { code: 'SYD', assumed: true };
    case '미국': return { code: 'LAX', assumed: true };
    case '베트남': return { code: 'SGN', assumed: true };
    case '뉴질랜드': return { code: 'AKL', assumed: true };
    default: return null;
  }
}

const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

export function classifyFlight(flight, { now, receipt } = {}) {
  const nowMs = toMs(now);
  let arriveMs;
  let timeAssumed = false;
  if (flight.arrivalAt) arriveMs = Date.parse(flight.arrivalAt);
  else { arriveMs = Date.parse(`${flight.arrivalDate}T12:00:00+09:00`); timeAssumed = true; }
  const arriveAt = Number.isFinite(arriveMs) ? new Date(arriveMs).toISOString() : null;

  const o = originFor(flight);
  const origin = o ? { code: o.code, name: AIRPORTS[o.code].name, assumed: o.assumed } : null;
  const route = TRANSIT[flight.country];
  let hours = null;
  if (o) hours = route ? route.hours : greatCircleKm(AIRPORTS[o.code], AIRPORTS.ICN) / 820 + 1.0;
  const departMs = hours != null && Number.isFinite(arriveMs) ? arriveMs - hours * 3600 * 1000 : null;
  const departAtEstimated = departMs != null ? new Date(departMs).toISOString() : null;
  const note = route && route.via ? '경유지 미확인 — 위치는 일정으로 계산한 예측' : '일정으로 계산한 예측';

  const base = { origin, departAtEstimated, arriveAt, predicted: true, timeAssumed, note, issues: [] };
  const ICN = AIRPORTS.ICN;
  const icnPos = { lat: ICN.lat, lon: ICN.lon };

  if (receipt) return { ...base, status: 'registered', statusLabel: '입고 등록 끝', progress: 1, position: icnPos };
  if (!flight.awb) return { ...base, status: 'awaiting_awb', statusLabel: '빌번호 대기', progress: null, position: null };

  const arrived = () => {
    const issues = [];
    if (nowMs - arriveMs > 30 * 3600 * 1000) issues.push('도착 예정 시각이 30시간 넘게 지났는데 입고 등록이 없음');
    return { ...base, status: 'arrived', statusLabel: '도착(예정 시각 지남)', progress: 1, position: icnPos, issues };
  };
  if (!o) {
    if (nowMs >= arriveMs) return arrived();
    return { ...base, status: 'unknown', statusLabel: '출발지 미확인', progress: null, position: null };
  }
  const from = AIRPORTS[o.code];
  if (nowMs < departMs) {
    return { ...base, status: 'before_departure', statusLabel: '출발 전(예측)', progress: 0, position: { lat: from.lat, lon: from.lon } };
  }
  if (nowMs < arriveMs) {
    const progress = (nowMs - departMs) / (arriveMs - departMs);
    return { ...base, status: 'in_flight', statusLabel: '비행 중(예측)', progress, position: greatCirclePoint(from, ICN, progress) };
  }
  return arrived();
}

export function externalLinks(flight) {
  const f = String((flight && flight.flight) || '').replace(/\s+/g, '').toUpperCase();
  if (!f) return { flightTrack: null, flightSearch: null };
  const m = f.match(/^([A-Z0-9]{2})(\d+)$/);
  const code = m ? `${m[1]}${m[2].replace(/^0+(?=\d)/, '')}`.toLowerCase() : f.toLowerCase();
  return {
    flightTrack: `https://www.flightradar24.com/data/flights/${code}`,
    flightSearch: `https://www.google.com/search?q=${encodeURIComponent(f)}`,
  };
}

export function airlineName(flight) {
  if (flight && flight.airlineText) return flight.airlineText;
  const p = String((flight && flight.awb) || '').slice(0, 3);
  return AWB_PREFIX_AIRLINE[p] || '';
}
