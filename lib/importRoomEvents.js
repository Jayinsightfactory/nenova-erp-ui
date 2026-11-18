// 카톡 빌번호방(백상 창고)·네노바&선율방(통관·검역 대행) 글을 "사건 종류"로 읽고 비행기 편에 붙이는 순수 함수.
// DB·네트워크·fs 를 쓰지 않는다. 공지와 처리 내용이 함께 있으면 둘 다 읽는다.
import { parseFlightNoticeMessage, normalizeAwb } from './importFlightNotice.js';

const SEON = '네노바&선율방';
const AWB_ROOM = '빌번호방';
const HOUR = 3600 * 1000;
const ROOM_SHORT = { [SEON]: '선율', [AWB_ROOM]: '백상' };

// room: 이 종류를 읽는 방('선율'=네노바&선율방, '백상'=빌번호방, '둘다')
export const ROOM_EVENT_TYPES = [
  { key: 'docs_received', label: '서류 수령 확인', level: 'info', room: '선율' },
  { key: 'docs_sent', label: '서류 전달 완료', level: 'info', room: '둘다' },
  { key: 'qty_resolved', label: '수량 정정 확인', level: 'info', room: '선율' },
  { key: 'manifest_issue', label: '마스터·하우스 적하 확인', level: 'red', room: '백상' },
  { key: 'manifest_resolved', label: '적하 정정 완료', level: 'info', room: '백상' },
  { key: 'quarantine_pass', label: '검역 합격', level: 'info', room: '선율' },
  { key: 'quarantine_fail', label: '검역 불합격·폐기', level: 'red', room: '선율' },
  { key: 'quarantine_plan', label: '검역 진행·예정', level: 'info', room: '둘다' },
  { key: 'docs_request', label: '서류 요청', level: 'red', room: '선율' },
  { key: 'docs_pending_staff', label: '서류 아직 못 받음(수입부 글)', level: 'amber', room: '선율' },
  { key: 'qty_mismatch', label: '검역증·인보이스 수량 다름', level: 'red', room: '선율' },
  { key: 'lmo', label: 'LMO 부기·검사', level: 'red', room: '선율' },
  { key: 'customs_inspection', label: '세관 검사', level: 'amber', room: '둘다' },
  { key: 'fumigation', label: '소독', level: 'info', room: '둘다' },
  { key: 'partial_arrival', label: '일부만 입항·잔량', level: 'red', room: '둘다' },
  { key: 'manifest_qty', label: '적하·수량 확인', level: 'info', room: '백상' },
  { key: 'warehoused', label: '창고 반입·물건 확인', level: 'info', room: '백상' },
  { key: 'arrival_late', label: '입항 늦어짐', level: 'amber', room: '백상' },
  { key: 'released', label: '반출', level: 'info', room: '백상' },
];
const TYPE_BY_KEY = new Map(ROOM_EVENT_TYPES.map((t) => [t.key, t]));
const NOT_COMPLETED = /못|아직|미수령|예정|요청|부탁|바랍|바람|나요|는지|으면|\?|않|안\s*(됐|되|했|하)/;

const DETECT = {
  docs_received: t => /서류\s*(받은|받았|수령\s*(완료|했|하였))/.test(t) && !NOT_COMPLETED.test(t),
  docs_sent: t => /서류.{0,12}(전달|발송|송부).{0,5}(완료|했습니다|하였습니다|드렸)/.test(t) && !NOT_COMPLETED.test(t),
  qty_resolved: t => /수량.{0,12}(정정|수정|일치).{0,8}(완료|확인|됐|되었)/.test(t) && !NOT_COMPLETED.test(t),
  manifest_issue: t => /마스터/.test(t) && /하우스/.test(t) && /맞으|떠있|확인|잘못/.test(t) && !/정정\s*완료|수정\s*완료/.test(t),
  manifest_resolved: t => /적하.{0,15}(정정|수정).{0,5}(완료|됐|되었)/.test(t) && !NOT_COMPLETED.test(t),
  quarantine_pass: (t) => /합격/.test(t) && !/불합격|합격.{0,5}(예정|나요|는지|으면|\?)/.test(t),
  quarantine_fail: (t) => /불합격|폐기|반송/.test(t),
  quarantine_plan: (t) => /(오전|오후)\s*검역/.test(t),
  docs_request: (t) => /서류.{0,12}(요청|부탁|전달\s*바랍|보내주시면)|재발행.{0,8}(나왔|전달|부탁)|서류\s*전달\s*부탁/.test(t),
  docs_pending_staff: (t) => /아직.{0,10}서류.{0,10}(못|안)|서류.{0,12}(못\s*받|받는\s*대로|받으면)/.test(t),
  qty_mismatch: (t) => /수량.{0,8}(상이|다릅|다르|안\s*맞|차이)/.test(t) || (/인보이스/.test(t) && /검역증/.test(t) && /덜\s*들어|더\s*들어|불일치/.test(t)),
  lmo: (t) => /LMO/i.test(t) || /부기가?\s*없/.test(t),
  // "검사 아닙니다/없습니다" 만 있는 글은 제외. 한 글에 둘 다 있으면 걸린 것으로 본다.
  customs_inspection: (t) => /검사\s*걸/.test(t) || /세관\s*검사(?!\s*(아닙|없습|아니고))/.test(t),
  fumigation: (t) => /소독/.test(t) && !/소독.{0,6}(없|아닌)/.test(t),
  partial_arrival: (t) => /만\s*입항|잔량|일부만\s*(실|입항|도착)|쇼트/.test(t),
  manifest_qty: (t) => /\d[\d,]*\s*CT\b/i.test(t) || /적하/.test(t),
  warehoused: (t) => /반입\s*(됐|된|완료|되었)|물건\s*확인되|입고\s*(됐|완료|되었)/.test(t),
  arrival_late: (t) => /입항이?\s*늦|작업이.{0,10}안\s*돼|내일\s*오전에\s*입고/.test(t),
  released: (t) => /반출\s*(신고|나간|완료)/.test(t),
};

// 나라 낱말: importFlightNotice.js 의 detectCountry 와 같은 낱말, 한 글에 여러 나라가 있으면 모두 돌려준다.
const COUNTRY_RULES = [
  ['에콰도르', /에콰/],
  ['중국', /중국|CLOUD|HUBFRESH|쿤밍/i],
  ['네덜란드', /네덜란드|홀렉스|Holex/i],
  ['태국', /태국|덴파레/],
  ['호주', /호주/],
  ['미국', /미국/],
  ['베트남', /베트남/],
  ['뉴질랜드', /뉴질랜드/],
  ['콜롬비아', /콜롬비아|콜|카장|수국/],
];
function detectCountries(t) {
  return COUNTRY_RULES.filter(([, re]) => re.test(t)).map(([name]) => name);
}

const AWB_G = /(?<![\d-])(\d{3}\s*-\s*\d{4}\s*[-\s]\s*\d{4}|\d{3}\s*-\s*\d{8}|\d{11})(?!\d)/g;
const WEEK_G = /(?<![\d-])(\d{1,2})\s*-\s*(\d)([a-z])?(?=\s*차|[\s,.)\]]|$)/gi;

function extractAwbs(t) {
  const out = [];
  for (const m of t.matchAll(AWB_G)) {
    const a = normalizeAwb(m[1]);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}
function extractWeeks(t) {
  const out = [];
  for (const m of t.matchAll(WEEK_G)) {
    const major = Number(m[1]);
    const sub = Number(m[2]);
    const hasCha = /^\s*차/.test(t.slice(m.index + m[0].length));
    if (!hasCha && (major < 1 || major > 53 || sub < 1 || sub > 4)) continue;
    const w = `${major}-${m[2]}${(m[3] || '').toLowerCase()}`;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
function extractSubHint(t) {
  const set = new Set();
  for (const m of t.matchAll(/(?<![A-Za-z])([AaBb])\s*차/g)) set.add(m[1].toLowerCase());
  return set.size === 1 ? [...set][0] : '';
}
function oneLine(raw) {
  return String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join(' / ').slice(0, 140);
}

export function extractRoomEvents(messages) {
  const out = [];
  (messages || []).forEach((m, idx) => {
    if (!m || (m.chatroom !== SEON && m.chatroom !== AWB_ROOM)) return;
    const ms = Date.parse(m.created_at);
    if (!Number.isFinite(ms)) return;
    const raw = String(m.message || '');
    // Operational follow-ups may share a message with a schedule notice.
    const flat = raw.replace(/\r/g, '').replace(/\n+/g, ' ');
    const short = ROOM_SHORT[m.chatroom];
    const awbs = extractAwbs(flat);
    const weekLabels = extractWeeks(flat);
    const countries = detectCountries(flat);
    const subHint = extractSubHint(flat);
    const text = oneLine(raw);
    for (const t of ROOM_EVENT_TYPES) {
      if (t.room !== '둘다' && t.room !== short) continue;
      if (!DETECT[t.key](flat)) continue;
      const ev = {
        type: t.key, label: t.label, level: t.level, room: m.chatroom, roomShort: short,
        at: new Date(ms).toISOString(), messageId: m.external_message_id == null ? null : m.external_message_id,
        sender: m.sender || '', text, awbs, weekLabels, countries, subHint, _idx: idx,
        approximate: !!m.timestamp_approximate || parseFlightNoticeMessage(m).length > 1,
        scopes: raw.split('\n').filter(l => extractWeeks(l).length).map(l => ({ weeks: extractWeeks(l), countries: detectCountries(l), hydrangeaOnly: /수국/.test(l) && !/카장|카네이션|장미/.test(l) })),
      };
      if (t.key === 'quarantine_plan') {
        const slot = /오전\s*검역/.test(flat) ? '오전' : '오후';
        const when = /진행\s*(했|하였)/.test(flat) ? '진행했음' : /진행\s*됩니다|진행됨/.test(flat) ? '진행됩니다' : /내일|명일/.test(flat) ? '내일' : /예정/.test(flat) ? '예정' : '';
        ev.note = `${slot} 검역${when ? ` ${when}` : ''}`;
      }
      out.push(ev);
    }
  });
  out.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a._idx - b._idx));
  out.forEach((e) => { delete e._idx; });
  return out;
}

const awbDigits = (v) => String(v || '').replace(/\D/g, '');
const weekBase = (w) => String(w || '').replace(/[a-z]$/, '');
const hasLetter = (w) => /[a-z]$/.test(String(w || ''));
const weekMatch = (a, b) => a === b || (weekBase(a) === weekBase(b) && (!hasLetter(a) || !hasLetter(b)));
const flightMs = (f) => Date.parse(f.arriveAt);

// 도착한 뒤에만 생기는 글(소독·합격·반입 등)은, 추정으로 붙일 때 아직 도착하지 않은 편에는 붙이지 않는다.
const POST_ARRIVAL_TYPES = new Set(['quarantine_pass', 'quarantine_fail', 'fumigation', 'customs_inspection', 'warehoused', 'released']);
const POST_ARRIVAL_SLACK_MS = 6 * 3600 * 1000;

export function linkRoomEvents(events, flights, { now, messages } = {}) {
  void now;
  const evs = (events || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const fl = flights || [];
  const byFlight = new Map();
  const unlinked = [];
  const put = (flight, ev, link) => {
    const copy = { ...ev, link, guessed: !!ev.approximate || ['country', 'thread', 'ambiguous'].includes(link) };
    if (!byFlight.has(flight.key)) byFlight.set(flight.key, []);
    byFlight.get(flight.key).push(copy);
  };

  // 같은 방의 글 시간표(글 id → 시각·방). 도착 공지 글은 편의 noticeMessageIds 로 편을 안다.
  const timeline = [];
  if (Array.isArray(messages) && messages.length) {
    for (const m of messages) {
      const ms = Date.parse(m && m.created_at);
      if (m && Number.isFinite(ms)) timeline.push({ id: m.external_message_id == null ? null : m.external_message_id, room: m.chatroom, ms });
    }
  } else {
    const seen = new Set();
    for (const e of evs) {
      const k = `${e.room}|${e.messageId}|${e.at}`;
      if (!seen.has(k)) { seen.add(k); timeline.push({ id: e.messageId, room: e.room, ms: Date.parse(e.at) }); }
    }
  }
  timeline.sort((a, b) => a.ms - b.ms);
  const msgFlights = new Map(); // 글 id → 그 글의 사건이 붙은 편 key 들
  const flightByKey = new Map(fl.map((f) => [f.key, f]));
  const flightsOfMessage = (id) => {
    if (id == null) return [];
    if (msgFlights.has(id)) return [...msgFlights.get(id)].map((k) => flightByKey.get(k)).filter(Boolean);
    return fl.filter((f) => Array.isArray(f.noticeMessageIds) && f.noticeMessageIds.includes(id));
  };

  for (const ev of evs) {
    const evMs = Date.parse(ev.at);
    const awbs = ev.awbs || [];
    const weeks = ev.weekLabels || [];
    const countries = ev.countries || [];
    let hit = [];
    let link = '';
    const arrivedBy = (f) => !POST_ARRIVAL_TYPES.has(ev.type) || (Number.isFinite(flightMs(f)) && flightMs(f) <= evMs + POST_ARRIVAL_SLACK_MS);

    // 1. 운송장
    if (awbs.length) {
      hit = fl.filter((f) => f.awb && awbs.includes(awbDigits(f.awb)));
      if (hit.length) link = 'awb';
    }
    // 2. 차수
    if (!awbs.length && !hit.length && weeks.length) {
      hit = fl.filter((f) => Math.abs(flightMs(f) - evMs) <= 14 * 24 * HOUR && (ev.scopes?.length
        ? ev.scopes.some(s => s.weeks.some(w => weekMatch(f.weekLabel, w)) && (!s.countries.length || s.countries.includes(f.country)) && (!s.hydrangeaOnly || /수국/.test(f.itemLabel || '')))
        : weeks.some(w => weekMatch(f.weekLabel, w)) && (!countries.length || countries.includes(f.country))));
      if (hit.length) link = 'week';
    }
    // 3. 나라 + 도착 예정이 글 시각 −36h ~ +72h
    if (!awbs.length && !weeks.length && !hit.length && countries.length) {
      let cands = fl.filter((f) => countries.includes(f.country) && Number.isFinite(flightMs(f)) && flightMs(f) - evMs >= -36 * HOUR && flightMs(f) - evMs <= 72 * HOUR && arrivedBy(f));
      if (ev.subHint) {
        const pref = cands.filter((f) => String(f.weekLabel).slice(-1).toLowerCase() === ev.subHint);
        if (pref.length) cands = pref;
      }
      cands.sort((a, b) => Math.abs(flightMs(a) - evMs) - Math.abs(flightMs(b) - evMs));
      if (cands.length) { hit = [cands[0]]; link = 'country'; }
    }
    // 4. 앞 글에 이어진 답글
    if (!awbs.length && !weeks.length && !hit.length && (/상기|해당|위\s*건|이건/.test(ev.text) || (!awbs.length && !weeks.length && !countries.length))) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const p = timeline[i];
        if (p.room !== ev.room || p.ms > evMs || (p.id != null && p.id === ev.messageId)) continue;
        if (evMs - p.ms > 60 * 60 * 1000) break;
        // 앞 글이 운송장·차수로 이미 편에 붙은 글이면 그 편을 그대로 따른다. 앞 글이 도착 공지일 때만 도착 여부를 따진다.
        const viaEvent = p.id != null && msgFlights.has(p.id);
        const fs = flightsOfMessage(p.id).filter((f) => viaEvent || arrivedBy(f));
        if (fs.length) { hit = fs; link = 'thread'; break; }
      }
    }

    if (!hit.length) { unlinked.push(ev); continue; }
    // Multiple candidates for one explicit scope cannot prove completion for each flight.
    if (link === 'week' && hit.length > 1 && (ev.scopes || []).some(s => hit.filter(f => s.weeks.some(w => weekMatch(f.weekLabel, w))).length > 1)) link = 'ambiguous';
    for (const f of hit) put(f, ev, link);
    if (ev.messageId != null) {
      if (!msgFlights.has(ev.messageId)) msgFlights.set(ev.messageId, new Set());
      hit.forEach((f) => msgFlights.get(ev.messageId).add(f.key));
    }
  }
  for (const list of byFlight.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { byFlight, unlinked };
}

export function roomEventType(key) {
  return TYPE_BY_KEY.get(key) || null;
}
