// 홈 "수입 비행기 현황" 조립: 카톡 도착 공지(편 목록) + 전산 입고 기록 → 화면용 목록·이슈·요약. 순수 함수.
import { mergeFlightNotices, formatAwb } from './importFlightNotice.js';
import { buildChecklist } from './importFlightChecklist.js';
import { extractRoomEvents, linkRoomEvents } from './importRoomEvents.js';
import { aircraftLink, formatRegistration, planRoute, classifyFlight, externalLinks, airlineName, AIRPORTS, routePoints } from './importFlightStatus.js';

const DAY = 24 * 60 * 60 * 1000;
const SHOW_PAST_MS = 4 * DAY;    // 도착 예정이 4일 넘게 지난 편은 목록에서 뺀다(입고 등록까지 끝난 경우)
const SHOW_PAST_OPEN_MS = 8 * DAY; // 입고 등록이 없으면 8일까지 남겨 이슈로 보인다
const STALE_NO_AWB_MS = 12 * 60 * 60 * 1000; // 빌번호 없는 사전 공지는 도착 예정 12시간 뒤 목록에서 뺀다
const STATUS_ORDER = { in_flight: 0, before_departure: 1, awaiting_awb: 2, arrived: 3, unknown: 3, registered: 4 };
// Card labels are scoped presentation overrides, separate from parsed cargo names.
const FLIGHT_CARD_TITLES = new Map([
  ['99204727892|2026|47-1|K4254', '콜롬비아카장알루수 47-1'],
]);

function arrivalMs(flight) {
  if (flight.arrivalAt) return Date.parse(flight.arrivalAt);
  if (flight.arrivalDate) return Date.parse(`${flight.arrivalDate}T12:00:00+09:00`);
  return NaN;
}

export function receiptIdentity(awb, year, week) {
  const parts = /^(\d{1,2})-(\d{1,2})([a-z]?)$/i.exec(String(week ?? '').trim());
  if (!awb || !/^\d{4}$/.test(String(year ?? '').trim()) || !parts) return '';
  return `${awb}|${String(year).trim()}|${Number(parts[1])}-${Number(parts[2])}${parts[3].toLowerCase()}`;
}

export function buildFlightBoard({ messages = [], receipts = new Map(), now = Date.now(), icn = new Map(), customs = new Map(), docsSent = {}, customsEnabled, icnEnabled } = {}) {
  const merged = mergeFlightNotices(messages, { now });
  const flights = [];
  const metas = [];
  const noticeAwbs = new Set();
  for (const f of merged) {
    const receiptKey = receiptIdentity(f.awb, f.arrivalDate?.slice(0, 4), f.weekLabel);
    if (receiptKey) noticeAwbs.add(receiptKey);
    const receipt = receiptKey ? receipts.get(receiptKey) || null : null;
    const at = arrivalMs(f);
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    if (age > (receipt ? SHOW_PAST_MS : SHOW_PAST_OPEN_MS)) continue;
    if (!f.awb) {
      // 같은 차수·나라에 빌번호 있는 편이 이미 있으면 사전 공지는 그 편으로 대체된 것으로 본다
      const superseded = merged.some(x => x.awb && x.country === f.country && x.weekMajor === f.weekMajor && String(x.subWeek)[0] === String(f.subWeek)[0]);
      if (superseded || age > STALE_NO_AWB_MS) continue;
    }
    // 콜롬비아처럼 도착 전에 입고 등록이 끝나는 나라가 있다 — 도착 예정 시각 전에는 등록 여부와 상관없이 비행 일정으로 분류한다.
    // 공항 운항 정보에 실제 예정 시각이 있으면 예측 위치·상태 계산에는 그 시각을 도착 시각으로 쓴다(편의 arriveAt 은 공지 값 유지).
    const icnRec = (f.flight && icn.get(`${f.flight}|${new Date(at).toISOString()}`) || icn.get(f.flight)) || null;
    const icnAt = icnRec && (icnRec.estimatedAt || icnRec.scheduledAt);
    // 공항 자료는 같은 편명의 다른 날 비행기일 수 있다(화물편은 날마다 일정이 다르다).
    // 공지와 3시간 넘게 어긋나면 공항 시각으로 덮지 않고 공지 시각으로 계산한다(어긋남은 경고로 따로 보인다).
    const ICN_TRUST_MS = 3 * 3600 * 1000;
    const icnClose = !!(f.arrivalAt && icnAt && Number.isFinite(Date.parse(icnAt)) && Math.abs(Date.parse(icnAt) - at) <= ICN_TRUST_MS);
    const useIcn = icnClose;
    const fForClass = useIcn ? { ...f, arrivalAt: icnAt, arrivalDate: String(icnAt).slice(0, 10), airportOrigin: icnRec.airportCode } : f;
    const effAt = useIcn ? Date.parse(icnAt) : at;
    const registeredEarly = !!receipt && now < effAt;
    let c = classifyFlight(fForClass, { now, receipt: registeredEarly ? null : receipt });
    if (icnClose && icnRec && icnRec.remark === '도착' && (c.status === 'before_departure' || c.status === 'in_flight' || c.status === 'awaiting_awb' || c.status === 'unknown')) {
      c = { ...c, status: 'arrived', statusLabel: '도착(공항 자료)', progress: 1, position: { lat: AIRPORTS.ICN.lat, lon: AIRPORTS.ICN.lon } };
    }
    // 경유 노선: 공항 자료로 경유지를 알면 출발지 → 경유지 → 인천으로 나눠 다시 계산한다.
    let plan = null;
    if (icnRec && f.awb && (c.status === 'before_departure' || c.status === 'in_flight')) {
      const delayed = (f.issues || []).some((t) => /^도착 변경|^지연·변경 공지/.test(t));
      // 경유지(출발 공항)는 공항 자료를 쓰되, 시각이 공지와 크게 어긋나면 도착 시각은 공지 값으로 계산한다.
      const icnForPlan = icnClose ? icnRec : { ...icnRec, estimatedAt: new Date(at).toISOString(), scheduledAt: new Date(at).toISOString() };
      plan = planRoute(fForClass, { now, icn: icnForPlan, delayed: delayed || !icnClose, timeSource: icnClose ? '공항 일정' : '공지 시각' });
      if (plan && plan.status !== 'arrived') {
        c = { ...c, status: plan.status, statusLabel: plan.statusLabel, progress: plan.progress, position: plan.position, note: plan.note, departAtEstimated: plan.firstLegDepartAtEstimated };
      } else plan = null;
    }
    // 입고 등록이 끝난 편의 공지 이슈(빌번호 없음 등)는 지나간 일이라 변경 이력만 남긴다.
    const noticeIssues = (f.issues || []).filter(text => !/^도착 변경|^박스 수 변경|^지연·변경 공지|^변경 공지가 일부/.test(text) && !(c.status === 'registered' && /아직 없음|미정/.test(text)));
    const issues = [...noticeIssues, ...(c.issues || [])];
    const origin = c.origin || null;
    const originPoint = origin ? AIRPORTS[origin.code] : null;
    flights.push({
      key: f.awb || `${f.weekLabel}|${f.country}|${f.itemLabel}`,
      weekLabel: f.weekLabel, country: f.country, itemLabel: f.itemLabel,
      displayName: FLIGHT_CARD_TITLES.get(`${receiptKey}|${f.flight}`) || '',
      airline: airlineName(f), awb: f.awb ? formatAwb(f.awb) : '', flight: f.flight || '',
      box: receipt?.boxes || f.box || null, boxSource: receipt?.boxes ? '전산 입고' : (f.box ? '공지' : ''),
      arrivalDate: f.arrivalDate, arrivalTime: f.arrivalTime || '', arriveAt: new Date(at).toISOString(), timeAssumed: !f.arrivalAt,
      departAtEstimated: c.departAtEstimated,
      status: c.status, statusLabel: c.statusLabel, progress: c.progress, position: c.position, note: c.note || '',
      origin: origin ? { code: origin.code, name: originPoint?.name || origin.code, assumed: !!origin.assumed, lat: originPoint?.lat, lon: originPoint?.lon } : null,
      route: plan ? plan.route : (originPoint ? routePoints(originPoint, AIRPORTS.ICN, 40) : []),
      via: plan ? plan.via : null, phase: plan ? plan.phase : null, lastLegDepartAt: plan ? plan.lastLegDepartAt : null,
      contents: receipt ? { source: '전산 입고', farms: receipt.farms, items: receipt.items.slice(0, 8) } : { source: '공지', farms: null, items: (f.items || []).slice(0, 8) },
      announcedCargo: { boxes: f.box ?? null, items: f.items || [] },
      receivedCargo: receipt ? { boxes: receipt.boxes, items: receipt.items, orderWeek: receipt.orderWeek, registeredAt: receipt.registeredAt } : null,
      invoiceCargo: receipt?.invoices || [],
      registeredEarly,
      receipt: receipt ? { registeredAt: receipt.registeredAt, orderWeek: receipt.orderWeek, farms: receipt.farms, boxes: receipt.boxes } : null,
      history: f.history || [], currentRooms: f.currentRooms || f.rooms || [],
      rooms: f.rooms || [], mentions: f.mentions || 1, lastPostedAt: f.lastPostedAt || null,
      noticeMessageIds: f.noticeMessageIds || [], roomEvents: [],
      links: externalLinks(f), issues,
      changeRooms: f.changeRooms || [], isChangeNotice: !!f.isChangeNotice,
      alerts: [], checklist: null, actual: null,
    });
    metas.push({ f, icnRec: icnClose ? icnRec : null, flight: flights[flights.length - 1] });
  }
  // 편 기본 정보 → 방 글(빌번호방·선율방) 연결 → checklist
  const linked = linkRoomEvents(extractRoomEvents(messages), flights, { now, messages });
  const roomView = (e) => ({ type: e.type, label: e.label, level: e.level, room: e.roomShort || e.room, at: e.at, text: e.text, guessed: !!e.guessed, messageId: e.messageId, link: e.link });
  for (const { f, icnRec, flight } of metas) {
    const roomEvs = linked.byFlight.get(flight.key) || [];
    flight.roomEvents = roomEvs.slice(-8).reverse().map(roomView);
    // 쪼개짐(A차·B차) 판단: 같은 차수·나라이면서 품목 묶음이 같은 편만 센다.
    // 콜롬비아의 카장 편과 수국 편처럼 원래 따로 오는 편은 쪼개짐이 아니다.
    const sameGroup = (x, y) => { const p = String(x || '').replace(/s/g, ''); const r = String(y || '').replace(/s/g, ''); return !p || !r || p === r || p.includes(r) || r.includes(p); };
    const siblings = metas.filter((m) => m.f !== f && m.f.awb && m.f.country === f.country && m.f.weekMajor === f.weekMajor && String(m.f.subWeek)[0] === String(f.subWeek)[0] && sameGroup(m.f.itemLabel, f.itemLabel)).length;
    const cl = buildChecklist(flight, { now, icn: icnRec, customs: f.awb ? customs.get(f.awb) || null : null, docsSent: f.awb ? docsSent[f.awb] || null : null, siblings, roomEvents: roomEvs });
    flight.checklist = cl;
    flight.alerts = cl.alerts;
    flight.actual = cl.actualArrival;
    // 공항 자료에 기체 등록번호가 있으면 「실제 위치」를 그 비행기 자체로 연다(화물 전용편도 정확히 열림).
    const reg = icnRec && icnRec.aircraftRegNo ? formatRegistration(icnRec.aircraftRegNo) : '';
    flight.aircraft = reg ? { regNo: reg, type: icnRec.aircraftType || '' } : null;
    flight.links = { ...flight.links, aircraftTrack: reg ? aircraftLink(reg) : null };
  }
  // 최근 3일 안에 입고 등록됐는데 도착 공지에서 못 찾은 운송장(공지 누락·수집 끊김 확인용)
  const unannounced = [];
  for (const [key, r] of receipts) {
    if (noticeAwbs.has(key)) continue;
    const reg = Date.parse(r.registeredAt);
    if (!Number.isFinite(reg) || now - reg > 3 * DAY) continue;
    unannounced.push({ awb: formatAwb(r.awb || key.split('|')[0]), country: r.country || '', orderWeek: r.orderWeek, boxes: r.boxes, farms: r.farms, registeredAt: r.registeredAt });
  }
  flights.sort((a, b) => ((STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)) || (Date.parse(a.arriveAt || 0) - Date.parse(b.arriveAt || 0)));
  const issues = [];
  for (const f of flights) for (const text of f.issues) issues.push({ key: f.key, label: `${f.weekLabel}차 ${f.country}${f.flight ? ` ${f.flight}` : ''}`, text });
  const todo = [];
  for (const f of flights) for (const a of f.alerts) todo.push({ key: f.key, label: `${f.weekLabel}차 ${f.country}${f.flight ? ` ${f.flight}` : ''}`, level: a.level, text: a.text, _at: Date.parse(f.arriveAt || 0) });
  todo.sort((a, b) => ((a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1)) || (a._at - b._at));
  todo.forEach((t) => { delete t._at; });
  const roomNews = linked.unlinked
    .filter((e) => e.level !== 'info' && now - Date.parse(e.at) <= 2 * DAY && Date.parse(e.at) <= now + DAY)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 6).map(roomView);
  const summary = { total: flights.length, beforeDeparture: 0, inFlight: 0, arrived: 0, registered: 0, awaitingAwb: 0, issues: issues.length, unannounced: unannounced.length, red: todo.filter((t) => t.level === 'red').length, amber: todo.filter((t) => t.level === 'amber').length };
  for (const f of flights) {
    if (f.status === 'before_departure') summary.beforeDeparture++;
    else if (f.status === 'in_flight') summary.inFlight++;
    else if (f.status === 'arrived' || f.status === 'unknown') summary.arrived++;
    else if (f.status === 'registered') summary.registered++;
    else if (f.status === 'awaiting_awb') summary.awaitingAwb++;
  }
  const sources = { icn: { enabled: icnEnabled === undefined ? icn.size > 0 : !!icnEnabled }, customs: { enabled: customsEnabled === undefined ? customs.size > 0 : !!customsEnabled } };
  return { flights, issues, todo, roomNews, unannounced, summary, sources, destination: { code: 'ICN', ...AIRPORTS.ICN } };
}
