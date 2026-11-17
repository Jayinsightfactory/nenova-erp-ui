// 수입부 카톡 방의 비행기 도착 공지 글을 읽어 "비행기 한 편(운송장 한 장)" 단위로 정리하는 순수 함수 모음.
// DB·네트워크·fs 를 쓰지 않는다.

export const IMPORT_SCHEDULE_ROOMS = ['스케줄방', '빌번호방', '네노바&선율방'];

const CHANGE_RE = /지연|변경|연착|취소|결항|재예약|딜레이/;
const HEADER_RE = /^[\s\[<*＊「【]*(?:\d\s*[.)]\s*)?(\d{1,2})\s*-\s*(\d)([a-z])?(?=\s|차|,|\]|>|\*|＊|$)\s*차?\s*(.*)$/i;
const AWB_RE = /(?<![\d-])(\d{3}\s*-\s*\d{4}\s*[-\s]\s*\d{4}|\d{3}\s*-\s*\d{8}|\d{11})(?!\d)/;
const FLIGHT_RE = /(?<![A-Za-z0-9])([A-Za-z]{2}|[A-Za-z][0-9]|[0-9][A-Za-z])\s?(\d{2,5})(?!\d)/;
const BOX_RE = /(?<![\d,])(\d[\d,]*)\s*(?:BOX|박스)/i;
const ITEM_RE = /^\s*[-•·]?\s*([^:：\d(][^:：]*?)\s*[:：]\s*(\d[\d,]*)\s*(?:박스|box|상자)/i;
const TOTAL_RE = /^\s*총\s*[:：]?\s*(\d[\d,]*)/;

const pad = (n) => String(n).padStart(2, '0');
const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

export function normalizeAwb(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  return d.length === 11 ? d : '';
}
export function formatAwb(awb11) {
  const d = normalizeAwb(awb11);
  return d ? `${d.slice(0, 3)}-${d.slice(3)}` : '';
}
export function awbCheckOk(awb11) {
  const d = normalizeAwb(awb11);
  if (!d) return false;
  return Number(d.slice(3, 10)) % 7 === Number(d[10]);
}

function detectCountry(text) {
  const t = String(text || '');
  if (/에콰/.test(t)) return '에콰도르';
  if (/중국|CLOUD|HUBFRESH|쿤밍/i.test(t)) return '중국';
  if (/네덜란드|홀렉스|Holex/i.test(t)) return '네덜란드';
  if (/태국|덴파레/.test(t)) return '태국';
  if (/호주/.test(t)) return '호주';
  if (/미국/.test(t)) return '미국';
  if (/베트남/.test(t)) return '베트남';
  if (/뉴질랜드/.test(t)) return '뉴질랜드';
  if (/콜롬비아|콜|카장|수국/.test(t)) return '콜롬비아';
  return '기타';
}

function resolveDate(month, day, createdAt) {
  const posted = new Date(toMs(createdAt) + 9 * 3600 * 1000); // 한국 날짜
  const py = posted.getUTCFullYear();
  const postedDay = Date.UTC(py, posted.getUTCMonth(), posted.getUTCDate());
  let year = py;
  const diff = (Date.UTC(year, month - 1, day) - postedDay) / 86400000;
  if (diff < -60) year += 1;
  else if (diff > 300) year -= 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseArrivalLine(line, createdAt) {
  let d = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!d) {
    // "내일 (화) 오전 8시 30분 도착 예정" 같은 상대 날짜는 게시일(한국 날짜) 기준으로 푼다
    const rel = line.match(/오늘|내일|모레/);
    if (!rel) return null;
    const base = new Date(toMs(createdAt) + 9 * 3600 * 1000 + { 오늘: 0, 내일: 1, 모레: 2 }[rel[0]] * 86400000);
    d = Object.assign([rel[0], String(base.getUTCMonth() + 1), String(base.getUTCDate())], { index: rel.index });
  }
  const month = Number(d[1]);
  const day = Number(d[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const arrivalDate = resolveDate(month, day, createdAt);
  const rest = line.slice(d.index + d[0].length);
  let time = '';
  let m = rest.match(/(?<!\d)(\d{1,2}):(\d{2})/);
  if (m) time = `${pad(Number(m[1]))}:${m[2]}`;
  else {
    m = rest.match(/(오전|오후)?\s*(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분)?/);
    if (m) {
      let h = Number(m[2]);
      if (m[1] === '오후' && h < 12) h += 12;
      if (m[1] === '오전' && h === 12) h = 0;
      time = `${pad(h)}:${pad(Number(m[3] || 0))}`;
    }
  }
  return { arrivalDate, arrivalTime: time, arrivalAt: time ? `${arrivalDate}T${time}:00+09:00` : null };
}

function cleanLabel(s) {
  // 머리줄에 이어 적힌 다른 차수 표기(", 45-3B차")는 품목 글에서 뺀다
  return String(s || '').replace(/^(?:[,\s]*\d{1,2}\s*-\s*\d[a-z]?\s*차?)+/i, ' ').replace(/[（(][^)）]*[)）]/g, ' ').replace(/[\[\]<>*＊「」【】]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseFlightNoticeMessage(msg, { now } = {}) {
  void now;
  const text = String((msg && msg.message) || '').replace(/\r/g, '');
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((ln, i) => {
    const m = ln.match(HEADER_RE);
    if (m) heads.push({ i, m, line: ln });
  });
  const out = [];
  let prevEnd = -1;
  heads.forEach((h, k) => {
    const end = (k + 1 < heads.length ? heads[k + 1].i : lines.length) - 1;
    let seg = lines.slice(h.i + 1, end + 1);
    let arrIdx = seg.findIndex((l) => /도착\s*예정/.test(l));
    let arr = arrIdx >= 0 ? parseArrivalLine(seg[arrIdx], msg.created_at) : null;
    const oneLine = h.line.match(/^(.*?)(\d{1,2}\s*월\s*\d{1,2}\s*일.*?도착\s*예정)(.*)$/);
    if (!arr && oneLine) {
      arr = parseArrivalLine(oneLine[2], msg.created_at);
      seg = [oneLine[3], ...seg];
      arrIdx = -1;
    }
    if (!arr) return;

    const headText = oneLine ? oneLine[1] : h.line;
    const airMatches = [...headText.matchAll(/[（(]\s*([A-Za-z][^)）]*?)\s*[)）]/g)];
    const airlineText = airMatches.length ? airMatches[airMatches.length - 1][1].trim() : '';
    const itemLabel = cleanLabel(oneLine ? (headText.match(HEADER_RE) || h.m)[4] : h.m[4]);
    let country = detectCountry(headText);
    if (country === '기타') {
      for (let j = h.i - 1; j >= Math.max(0, h.i - 3) && country === '기타'; j--) country = detectCountry(lines[j]);
    }

    let awb = '';
    let flight = '';
    let box = null;
    let total = null;
    const items = [];
    seg.forEach((l, idx) => {
      if (idx === arrIdx) return;
      const tm = l.match(TOTAL_RE);
      if (tm) { total = Number(tm[1].replace(/,/g, '')); return; }
      const im = !/^\s*[(（]/.test(l) && l.match(ITEM_RE);
      if (im) {
        items.push({ name: im[1].trim(), box: Number(im[2].replace(/,/g, '')) });
        return;
      }
      // 괄호·AWB 낱말 없이 번호만 적힌 줄("18012345675 12BOX")도 운송장 줄로 본다
      if (!(/^\s*[(（]/.test(l) || /AWB|운송장|빌번호/i.test(l) || AWB_RE.test(l))) return;
      let s = l;
      const am = s.match(AWB_RE);
      if (am) { if (!awb) awb = normalizeAwb(am[1]); s = s.replace(am[0], ' '); }
      s = s.replace(/AWB/gi, ' ');
      const fm = s.match(FLIGHT_RE);
      if (fm) { if (!flight) flight = (fm[1] + fm[2]).toUpperCase(); s = s.replace(fm[0], ' '); }
      const bm = s.match(BOX_RE);
      if (bm && box === null) box = Number(bm[1].replace(/,/g, ''));
    });
    if (box === null && total !== null) box = total;

    const scope = lines.slice(prevEnd + 1, end + 1);
    const cl = scope.find((l) => CHANGE_RE.test(l));
    prevEnd = end;
    out.push({
      weekLabel: `${Number(h.m[1])}-${h.m[2]}${(h.m[3] || '').toLowerCase()}`,
      weekMajor: Number(h.m[1]),
      subWeek: `${h.m[2]}${(h.m[3] || '').toLowerCase()}`,
      country, itemLabel, airlineText, awb, flight, box,
      arrivalDate: arr.arrivalDate, arrivalTime: arr.arrivalTime, arrivalAt: arr.arrivalAt,
      items,
      isChangeNotice: !!cl,
      changeReason: cl ? cl.replace(/[<>*＊]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) : '',
      room: msg.chatroom, postedAt: msg.created_at, messageId: msg.external_message_id,
    });
  });
  return out;
}

const arrivalMs = (f) => (f.arrivalAt ? Date.parse(f.arrivalAt) : Date.parse(`${f.arrivalDate}T12:00:00+09:00`));
const fmtArrival = (f) => {
  const [, mo, d] = f.arrivalDate.split('-');
  return `${mo}/${d}${f.arrivalTime ? ` ${f.arrivalTime}` : ''}`;
};
const labelMatch = (a, b) => !a || !b || a === b || a.includes(b) || b.includes(a);
const fmtBox = (n) => Number(n).toLocaleString('en-US');

export function mergeFlightNotices(messages, { now } = {}) {
  const notices = [];
  (messages || []).forEach((m) => parseFlightNoticeMessage(m, { now }).forEach((n) => notices.push(n)));
  notices.sort((a, b) => toMs(a.postedAt) - toMs(b.postedAt));

  const entries = [];
  const byAwb = new Map();
  // 사전 공지 "46-2" 와 운송장 공지 "46-2a" 는 같은 차수로 본다(둘 다 글자가 붙어 있으면 글자까지 같아야 함)
  const weekMatch = (a, b) => a === b || (a.replace(/[a-z]$/, '') === b.replace(/[a-z]$/, '') && (!/[a-z]$/.test(a) || !/[a-z]$/.test(b)));
  const sameFlightKey = (e, n) => weekMatch(e.weekLabel, n.weekLabel) && e.country === n.country && labelMatch(e.itemLabel, n.itemLabel);

  for (const n of notices) {
    let e = null;
    if (n.awb) {
      e = byAwb.get(n.awb) || entries.find((x) => !x.awb && sameFlightKey(x, n)) || null;
    } else {
      e = entries.find((x) => !x.awb && sameFlightKey(x, n)) || null;
      if (!e) {
        const c = entries.filter((x) => x.awb && sameFlightKey(x, n));
        if (c.length === 1) e = c[0];
      }
    }
    if (!e) { e = { awb: '', weekLabel: n.weekLabel, country: n.country, itemLabel: n.itemLabel, notices: [] }; entries.push(e); }
    e.notices.push(n);
    if (n.itemLabel && !e.itemLabel) e.itemLabel = n.itemLabel;
    if (n.awb) { e.awb = n.awb; byAwb.set(n.awb, e); }
  }

  const result = entries.map((e) => {
    const list = e.notices;
    const last = list[list.length - 1];
    const cur = { ...last };
    for (const k of ['awb', 'flight', 'airlineText', 'itemLabel']) {
      if (!cur[k]) for (let i = list.length - 1; i >= 0; i--) if (list[i][k]) { cur[k] = list[i][k]; break; }
    }
    if (cur.box == null) for (let i = list.length - 1; i >= 0; i--) if (list[i].box != null) { cur.box = list[i].box; break; }
    if (!cur.items.length) for (let i = list.length - 1; i >= 0; i--) if (list[i].items.length) { cur.items = list[i].items; break; }

    // 값이 바뀐 것만 이력에 남긴다
    const history = [];
    for (const n of list) {
      const prev = history[history.length - 1];
      const arr = n.arrivalAt || n.arrivalDate;
      if (!prev || prev.arr !== arr || (n.box != null && n.box !== prev.box)) {
        history.push({ postedAt: n.postedAt, arr, box: n.box != null ? n.box : prev ? prev.box : null, n });
      }
    }
    const issues = [];
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1].n;
      const b = history[i].n;
      if (a.arrivalAt !== b.arrivalAt || a.arrivalDate !== b.arrivalDate) {
        const resolved = a.arrivalDate === b.arrivalDate && (!a.arrivalAt || !b.arrivalAt);
        if (!resolved) issues.push(`도착 변경: ${fmtArrival(a)} → ${fmtArrival(b)}`);
      }
      if (history[i - 1].box != null && history[i].box != null && history[i - 1].box !== history[i].box) {
        issues.push(`박스 수 변경: ${fmtBox(history[i - 1].box)} → ${fmtBox(history[i].box)}`);
      }
    }
    const changeNotices = list.filter((n) => n.isChangeNotice);
    if (changeNotices.length) issues.push(`지연·변경 공지: ${changeNotices[changeNotices.length - 1].changeReason}`);
    if (!cur.arrivalAt) issues.push('도착 시각 미정');
    if (!cur.awb) issues.push('빌번호 아직 없음');
    else {
      if (!cur.flight) issues.push('편명 아직 없음');
      if (!awbCheckOk(cur.awb)) issues.push('빌번호 확인 필요(검산 불일치)');
    }
    const rooms = [...new Set(list.map((n) => n.room).filter(Boolean))];
    if (changeNotices.length) {
      const cr = [...new Set(changeNotices.map((n) => n.room).filter(Boolean))];
      if (cr.length < IMPORT_SCHEDULE_ROOMS.length) issues.push(`변경 공지가 일부 방에만 올라옴(올라온 방: ${cr.join(', ')})`);
    }
    return {
      ...cur,
      isChangeNotice: changeNotices.length > 0,
      mentions: list.length,
      rooms,
      firstPostedAt: list[0].postedAt,
      lastPostedAt: last.postedAt,
      history: history.map(({ postedAt, arr, box }) => ({ postedAt, ...(/T/.test(arr) ? { arrivalAt: arr } : { arrivalDate: arr }), box })),
      issues,
    };
  });
  result.sort((a, b) => arrivalMs(a) - arrivalMs(b));
  return result;
}
