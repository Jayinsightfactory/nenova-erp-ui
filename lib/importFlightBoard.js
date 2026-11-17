// 홈 "수입 비행기 현황" 조립: 카톡 도착 공지(편 목록) + 전산 입고 기록 → 화면용 목록·이슈·요약. 순수 함수.
import { mergeFlightNotices, formatAwb } from './importFlightNotice.js';
import { classifyFlight, externalLinks, airlineName, AIRPORTS, routePoints } from './importFlightStatus.js';

const DAY = 24 * 60 * 60 * 1000;
const SHOW_PAST_MS = 4 * DAY;    // 도착 예정이 4일 넘게 지난 편은 목록에서 뺀다(입고 등록까지 끝난 경우)
const SHOW_PAST_OPEN_MS = 8 * DAY; // 입고 등록이 없으면 8일까지 남겨 이슈로 보인다
const STALE_NO_AWB_MS = 12 * 60 * 60 * 1000; // 빌번호 없는 사전 공지는 도착 예정 12시간 뒤 목록에서 뺀다
const STATUS_ORDER = { in_flight: 0, before_departure: 1, awaiting_awb: 2, arrived: 3, unknown: 3, registered: 4 };

function arrivalMs(flight) {
  if (flight.arrivalAt) return Date.parse(flight.arrivalAt);
  if (flight.arrivalDate) return Date.parse(`${flight.arrivalDate}T12:00:00+09:00`);
  return NaN;
}

export function buildFlightBoard({ messages = [], receipts = new Map(), now = Date.now() } = {}) {
  const merged = mergeFlightNotices(messages, { now });
  const flights = [];
  const noticeAwbs = new Set();
  for (const f of merged) {
    if (f.awb) noticeAwbs.add(f.awb);
    const receipt = f.awb ? receipts.get(f.awb) || null : null;
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
    const registeredEarly = !!receipt && now < at;
    const c = classifyFlight(f, { now, receipt: registeredEarly ? null : receipt });
    // 입고 등록이 끝난 편의 공지 이슈(빌번호 없음 등)는 지나간 일이라 변경 이력만 남긴다.
    const noticeIssues = (f.issues || []).filter(text => !(c.status === 'registered' && /아직 없음|미정/.test(text)));
    const issues = [...noticeIssues, ...(c.issues || [])];
    const origin = c.origin || null;
    const originPoint = origin ? AIRPORTS[origin.code] : null;
    flights.push({
      key: f.awb || `${f.weekLabel}|${f.country}|${f.itemLabel}`,
      weekLabel: f.weekLabel, country: f.country, itemLabel: f.itemLabel,
      airline: airlineName(f), awb: f.awb ? formatAwb(f.awb) : '', flight: f.flight || '',
      box: receipt?.boxes || f.box || null, boxSource: receipt?.boxes ? '전산 입고' : (f.box ? '공지' : ''),
      arrivalDate: f.arrivalDate, arrivalTime: f.arrivalTime || '', arriveAt: c.arriveAt, timeAssumed: !f.arrivalAt,
      departAtEstimated: c.departAtEstimated,
      status: c.status, statusLabel: c.statusLabel, progress: c.progress, position: c.position, note: c.note || '',
      origin: origin ? { code: origin.code, name: originPoint?.name || origin.code, assumed: !!origin.assumed, lat: originPoint?.lat, lon: originPoint?.lon } : null,
      route: originPoint ? routePoints(originPoint, AIRPORTS.ICN, 40) : [],
      contents: receipt ? { source: '전산 입고', farms: receipt.farms, items: receipt.items.slice(0, 8) } : { source: '공지', farms: null, items: (f.items || []).slice(0, 8) },
      registeredEarly,
      receipt: receipt ? { registeredAt: receipt.registeredAt, orderWeek: receipt.orderWeek, farms: receipt.farms, boxes: receipt.boxes } : null,
      rooms: f.rooms || [], mentions: f.mentions || 1, lastPostedAt: f.lastPostedAt || null,
      links: externalLinks(f), issues,
    });
  }
  // 최근 3일 안에 입고 등록됐는데 도착 공지에서 못 찾은 운송장(공지 누락·수집 끊김 확인용)
  const unannounced = [];
  for (const [awb, r] of receipts) {
    if (noticeAwbs.has(awb)) continue;
    const reg = Date.parse(r.registeredAt);
    if (!Number.isFinite(reg) || now - reg > 3 * DAY) continue;
    unannounced.push({ awb: formatAwb(awb), country: r.country || '', orderWeek: r.orderWeek, boxes: r.boxes, farms: r.farms, registeredAt: r.registeredAt });
  }
  flights.sort((a, b) => ((STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)) || (Date.parse(a.arriveAt || 0) - Date.parse(b.arriveAt || 0)));
  const issues = [];
  for (const f of flights) for (const text of f.issues) issues.push({ key: f.key, label: `${f.weekLabel}차 ${f.country}${f.flight ? ` ${f.flight}` : ''}`, text });
  const summary = { total: flights.length, beforeDeparture: 0, inFlight: 0, arrived: 0, registered: 0, awaitingAwb: 0, issues: issues.length, unannounced: unannounced.length };
  for (const f of flights) {
    if (f.status === 'before_departure') summary.beforeDeparture++;
    else if (f.status === 'in_flight') summary.inFlight++;
    else if (f.status === 'arrived' || f.status === 'unknown') summary.arrived++;
    else if (f.status === 'registered') summary.registered++;
    else if (f.status === 'awaiting_awb') summary.awaitingAwb++;
  }
  return { flights, issues, unannounced, summary, destination: { code: 'ICN', ...AIRPORTS.ICN } };
}
