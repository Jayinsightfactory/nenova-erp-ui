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
  // 경유지(인천행 마지막 비행기가 떠나는 공항) — 인천공항 운항 정보의 출발 공항 코드로 찾는다
  YVR: { name: '밴쿠버', lat: 49.1947, lon: -123.1792 },
  YYZ: { name: '토론토', lat: 43.6777, lon: -79.6248 },
  HKG: { name: '홍콩', lat: 22.308, lon: 113.9185 },
  CVG: { name: '신시내티', lat: 39.0488, lon: -84.6678 },
  NLU: { name: '멕시코시티', lat: 19.7456, lon: -99.0086 },
  MEX: { name: '멕시코시티', lat: 19.4361, lon: -99.0719 },
  ATL: { name: '애틀랜타', lat: 33.6407, lon: -84.4277 },
  MIA: { name: '마이애미', lat: 25.7959, lon: -80.287 },
  JFK: { name: '뉴욕', lat: 40.6413, lon: -73.7781 },
  ORD: { name: '시카고', lat: 41.9742, lon: -87.9073 },
  DFW: { name: '댈러스', lat: 32.8998, lon: -97.0403 },
  SEA: { name: '시애틀', lat: 47.4502, lon: -122.3088 },
  SFO: { name: '샌프란시스코', lat: 37.6213, lon: -122.379 },
  ANC: { name: '앵커리지', lat: 61.1743, lon: -149.9982 },
  HNL: { name: '호놀룰루', lat: 21.3187, lon: -157.9225 },
  DOH: { name: '도하', lat: 25.2731, lon: 51.608 },
  IST: { name: '이스탄불', lat: 41.2753, lon: 28.7519 },
  DXB: { name: '두바이', lat: 25.2532, lon: 55.3657 },
  FRA: { name: '프랑크푸르트', lat: 50.0379, lon: 8.5622 },
  CDG: { name: '파리', lat: 49.0097, lon: 2.5479 },
  LUX: { name: '룩셈부르크', lat: 49.6233, lon: 6.2044 },
  LGG: { name: '리에주', lat: 50.6374, lon: 5.4432 },
  MAD: { name: '마드리드', lat: 40.4983, lon: -3.5676 },
  ADD: { name: '아디스아바바', lat: 8.9779, lon: 38.7993 },
  PVG: { name: '상하이', lat: 31.1443, lon: 121.8083 },
  CAN: { name: '광저우', lat: 23.3924, lon: 113.2988 },
  PEK: { name: '베이징', lat: 40.0799, lon: 116.6031 },
  PKX: { name: '베이징', lat: 39.5098, lon: 116.4105 },
  SZX: { name: '선전', lat: 22.6393, lon: 113.8107 },
  CTU: { name: '청두', lat: 30.5785, lon: 103.9471 },
  TFU: { name: '청두', lat: 30.3197, lon: 104.4453 },
  XMN: { name: '샤먼', lat: 24.544, lon: 118.1277 },
  TAO: { name: '칭다오', lat: 36.3619, lon: 120.0883 },
  TNA: { name: '지난', lat: 36.8572, lon: 117.2161 },
  HAN: { name: '하노이', lat: 21.2212, lon: 105.8072 },
  NRT: { name: '도쿄', lat: 35.772, lon: 140.3929 },
  TPE: { name: '타이베이', lat: 25.0797, lon: 121.2342 },
  SIN: { name: '싱가포르', lat: 1.3644, lon: 103.9915 },
  MEL: { name: '멜버른', lat: -37.669, lon: 144.841 },
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

// 공항 자료의 기체 등록번호는 붙여 쓴 모양("BHPQ", "CFIVM", "HL7436")으로 온다. 공개 추적 화면 주소는 나라 머리글자 뒤에 줄표가 들어간다.
const REG_NO_HYPHEN = /^(HLd|JAd|Nd)/; // 한국·일본·미국은 줄표 없음
const REG_PREFIX2 = ['A7', 'A6', '9V', '9M', '9H', '4X', 'VH', 'VN', 'HS', 'PH', 'TC', 'XA', 'OO', 'LX', 'EI', 'EC', 'RP', 'PK', 'ZK', 'ET', 'CC', 'HK', 'HC', 'OE', 'OH', 'OY', 'SE', 'LN', 'HB', 'CS', 'SP', 'OK', 'HA', 'UR', 'RA', 'ZS', 'VT', 'AP', 'TF', 'YL', 'ES', 'LY', 'UK', 'UP', 'PR', 'PP', 'PT', 'LV', 'CP', 'OB', 'YV', 'TI', 'HP', 'XB', 'XC', 'VP', 'VQ', 'EW', 'EK', '4K', 'UN', 'JY', 'SU', 'ST', '5Y', '5N', 'CN', 'TS', 'SX', 'YR', 'LZ', 'YU', '9A', 'S5', 'OM', 'ER', 'EY', 'EX', 'EP', 'YI', 'YK', 'OD', 'HZ', '9K', 'A9', 'A4', 'S2', '4R', '9N', 'XY', 'XU', 'RDPL', 'V8', 'P2', 'DQ'];
const REG_PREFIX1 = ['B', 'C', 'D', 'F', 'G', 'I', 'M'];
export function formatRegistration(raw) {
  const r = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (r.length < 4 || r.length > 7) return '';
  if (REG_NO_HYPHEN.test(r)) return r;
  const p2 = REG_PREFIX2.find((p) => r.startsWith(p) && r.length - p.length >= 2);
  if (p2) return `${p2}-${r.slice(p2.length)}`;
  if (REG_PREFIX1.includes(r[0])) return `${r[0]}-${r.slice(1)}`;
  return r;
}
// 기체 등록번호로 여는 공개 추적 화면 주소(그 비행기 자체). 운송장 번호는 어떤 외부 주소에도 넣지 않는다.
export function aircraftLink(regNo) {
  const reg = formatRegistration(regNo);
  return reg ? `https://www.flightradar24.com/data/aircraft/${reg.toLowerCase()}` : null;
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

// 경유 노선: 인천공항 운항 정보로 "인천행 마지막 비행기"의 출발 공항과 도착 시각을 알면
// 출발지 → 경유지 → 인천 두 구간으로 나눠 계산한다. 마지막 구간은 공항 자료 기준, 그 앞은 추정이다.
export const LAYOVER_HOURS_ASSUMED = 6; // 경유지에서 갈아타는 시간(추정)
const legHours = (a, b) => greatCircleKm(a, b) / 820 + 1.0;

export function planRoute(flight, { now, icn, delayed = false } = {}) {
  const o = originFor(flight);
  if (!o || !icn) return null;
  const arriveIso = icn.estimatedAt || icn.scheduledAt;
  const arriveMs = arriveIso ? Date.parse(arriveIso) : NaN;
  const viaPoint = icn.airportCode ? AIRPORTS[icn.airportCode] : null;
  if (!Number.isFinite(arriveMs) || !viaPoint || icn.airportCode === o.code || icn.airportCode === 'ICN') return null;
  const nowMs = toMs(now);
  const origin = AIRPORTS[o.code];
  const dest = AIRPORTS.ICN;
  const H = 3600 * 1000;
  const d1 = greatCircleKm(origin, viaPoint);
  const d2 = greatCircleKm(viaPoint, dest);
  const total = d1 + d2;
  const lastDepMs = arriveMs - legHours(viaPoint, dest) * H;
  const firstArrMs = lastDepMs - LAYOVER_HOURS_ASSUMED * H;
  const firstDepMs = firstArrMs - legHours(origin, viaPoint) * H;
  const via = { code: icn.airportCode, name: viaPoint.name, lat: viaPoint.lat, lon: viaPoint.lon };
  const iso = (ms) => new Date(ms).toISOString();
  const base = {
    via, route: [...routePoints(origin, viaPoint, 24), ...routePoints(viaPoint, dest, 24)],
    firstLegDepartAtEstimated: iso(firstDepMs), lastLegDepartAt: iso(lastDepMs), arriveAt: iso(arriveMs),
    note: `${viaPoint.name} 경유 — 마지막 구간(${viaPoint.name} → 인천)은 공항 자료 기준, 그 앞은 추정`,
  };
  // 도착이 한 번 이상 미뤄진 편은 원래 일정대로 움직였다고 볼 수 없다 — 마지막 비행기가 뜨기 전이면 경유지에 서 있는 것으로 본다.
  if (delayed && nowMs < lastDepMs) return { ...base, phase: 'layover', status: 'in_flight', statusLabel: `${viaPoint.name} 경유지 대기(추정)`, progress: d1 / total, position: { lat: viaPoint.lat, lon: viaPoint.lon } };
  if (nowMs < firstDepMs) return { ...base, phase: 'before_departure', status: 'before_departure', statusLabel: '출발 전(예측)', progress: 0, position: { lat: origin.lat, lon: origin.lon } };
  if (nowMs < firstArrMs) {
    const t = (nowMs - firstDepMs) / (firstArrMs - firstDepMs);
    return { ...base, phase: 'leg1', status: 'in_flight', statusLabel: `${viaPoint.name}(경유지)로 이동 중(추정)`, progress: (d1 * t) / total, position: greatCirclePoint(origin, viaPoint, t) };
  }
  if (nowMs < lastDepMs) return { ...base, phase: 'layover', status: 'in_flight', statusLabel: `${viaPoint.name} 경유지 대기(추정)`, progress: d1 / total, position: { lat: viaPoint.lat, lon: viaPoint.lon } };
  if (nowMs < arriveMs) {
    const t = (nowMs - lastDepMs) / (arriveMs - lastDepMs);
    return { ...base, phase: 'leg2', status: 'in_flight', statusLabel: `${viaPoint.name} → 인천 비행 중`, progress: (d1 + d2 * t) / total, position: greatCirclePoint(viaPoint, dest, t) };
  }
  return { ...base, phase: 'arrived', status: 'arrived', statusLabel: '도착(예정 시각 지남)', progress: 1, position: { lat: dest.lat, lon: dest.lon } };
}
