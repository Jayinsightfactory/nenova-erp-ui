// lib/incomingBoxByCountry.js — 차수별 국가 입고 박스 집계 (읽기 전용 계산)
//
// 원천 1: WarehouseMaster/WarehouseDetail (ERP, SELECT only) — AWB(OrderNo)별 Σ BoxQuantity
// 원천 2: WebFlightScheduleBox (웹 전용) — 비행 스케줄 카톡방 공지에서 파싱한 AWB별 박스
//
// 최종 박스 규칙 (2026-10-06 카톡↔웹 대조에서 확정)
//  ① 같은 선적의 AWB 변경 재공지(중복)는 웹에 입고된 AWB 1건만 센다.
//  ② 웹에 입고는 있으나 박스 칸이 0(단/송이로만 입력: 네덜란드·태국·중국·에콰도르)이면 카톡 박스를 쓴다.
//  ③ 웹·카톡 모두 박스가 있으면 웹(전산) 박스를 쓴다. 단, 콜롬비아 장미 라인이 '단'만 입력되고 박스가 0인
//     AWB(22차~ Maxiflores·Esperance·Construnorte·Flores Tiba)는 카톡 박스를 쓴다(10단=1박스로 차이가 설명되는 경우).
//  ④ 웹에만 있으면 웹 박스, 카톡에만 있으면 카톡 박스(입고 확인 필요 표시).
//  ⑤ 카톡에 AWB 없이 품목내역만 있는 공지는 같은 차수·국가에 AWB 선적이 없을 때만 품목합으로 추정.
//  웹 '국내' 입고는 비행 스케줄 대상이 아니라 제외한다.

export const BOX_COUNTRIES = new Set(['콜롬비아', '호주', '베트남', '미국']);
const COUNTRY_ALIASES = { 콜럼비아: '콜롬비아', 네델란드: '네덜란드', 에쿠아도르: '에콰도르', 에콰돌: '에콰도르' };
const ITEM_KO = { carnation: '카네이션', 카네: '카네이션', rose: '장미', alstro: '알스트로', alstroemeria: '알스트로', 알스: '알스트로', ruscus: '루스커스', 루스: '루스커스', hydrangea: '수국' };

export function normalizeAwb(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0+/, '');
}

export function normalizeWeekKey(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

export function weekLabel(weekKey) {
  const m = String(weekKey || '').match(/^(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : String(weekKey || '');
}

export function normalizeCountry(raw) {
  const t = String(raw || '').trim();
  const u = t.toUpperCase();
  if (!t) return null;
  if (/^콜|콜카장|콜수국|콜롬비아|콜럼비아/.test(t)) return '콜롬비아';
  for (const k of ['네덜란드', '태국', '중국', '호주', '에콰', '미국', '뉴질랜드', '베트남', '일본', '케냐', '말레이시아']) {
    if (t.includes(k)) return k === '에콰' ? '에콰도르' : k;
  }
  if (/HOLEX|이지/.test(u) || u.startsWith('EZ')) return '네덜란드';
  if (/CLOUD|MEL|HENG|OKYONG/.test(u)) return '중국';
  if (/ROYAL BASE/.test(u)) return '베트남';
  if (t.includes('덴파레')) return '태국';
  return COUNTRY_ALIASES[t] || null;
}

export function fixCountryByFarm(country, farmNames) {
  const f = String(farmNames || '').toUpperCase();
  if (country === '콜롬비아' && /YUNNAN|OKYONG|MELODY|CLOUD|HUBFRESH|HENGGE/.test(f)) return '중국';
  if (country === '콜롬비아' && /UNIQUE FLOWERS/.test(f)) return '미국';
  if (/HOLEX|^EZ$|EZ FLOWER/.test(f)) return '네덜란드';
  if (/JAPAN|JAPON/.test(f)) return '일본';
  return COUNTRY_ALIASES[country] || country;
}

function normalizeItem(raw, country) {
  const t = String(raw || '');
  const u = t.toUpperCase();
  if (country === '콜롬비아') {
    const hasS = t.includes('수국');
    const hasK = /카장|카창|카네이션/.test(t);
    if (hasS && hasK) return '수국+카장';
    if (hasS) return '수국';
    return '카장';
  }
  if (country === '네덜란드') return /이지|EZ/.test(u) && !/HOLEX|홀렉스/.test(u) ? '이지플라워' : '홀렉스';
  if (country === '태국') return '덴파레';
  if (country === '중국') {
    if (u.includes('CLOUD')) return 'CLOUD';
    if (u.includes('MEL') || t.includes('멜로디')) return 'MELODY';
    if (u.includes('HENG')) return 'HENGGE';
    if (u.includes('OKYONG')) return 'OKYONG';
    return '중국(농장미표기)';
  }
  return { 호주: '프리미움 그린', 미국: '후드카날', 에콰도르: '장미', 베트남: 'Royal Base', 뉴질랜드: 'NZBloom' }[country]
    || t.replace(/\(.*?\)|\[.*?\]/g, '').trim() || '미표기';
}

const DATE_LINE = /^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 .*-+$/;
const MSG_LINE = /^\[(.+?)\] \[(오전|오후) (\d{1,2}):(\d{2})\] ?(.*)$/;
const HDR_BRACKET = /\[\s*(\d{1,2})\s*-\s*(\d{1,2})\s*([A-Za-z]?)\s*차?\s*([^\]\n]*)\]([^\n]*)/g;
const HDR_PLAIN = /^[ \t＊*]*(\d{1,2})\s*-\s*(\d{1,2})\s*([A-Za-z]?)\s*(?:차)?\s+((?:콜|네덜란드|태국|중국|호주|에콰|미국|뉴질랜드|베트남|Cloud|CLOUD|Royal|Holex|Mel|MEL|HENG|\[콜|A 콜|B 콜)[^\n(]*)(\([^\n]*)?$/gm;
const INLINE = /(콜\s*카장|콜\s*수국)\s*(\d{1,2})-(\d{1,2})([A-Za-z]?)\s*차/g;
const AWB_LINE = /^[ \t(]*(\d{3}[ \-]{0,2}\d{3,4}[ \-]{0,2}\d{3,5}|\d{10,11})[ \t/]+(?:([A-Za-z가-힣]{1,2}[\s\-]?\d{2,5}|[A-Z0-9]{3,7})[ \t/]+)?(\d{1,4}|_|\?)?\s*(?:box|boxes|박스)?[ \t)]*$/gim;
const ARRIVAL = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const ITEM_LINE = /^[ \t]*(카네이션|카네|장미|알스트로|알스|루스커스|루스|수국|덴파레|Carnation|Rose|Alstro\w*|Ruscus|Hydrangea)[^\n]*?(\d+)\s*(?:박스|벅스|box)/gim;
const PENDING_BOX = /\(\s*확인[^\d\n]*(\d{1,4})\s*box/i;

function itemsIn(segment) {
  const out = [];
  for (const m of segment.matchAll(ITEM_LINE)) {
    const low = m[1].toLowerCase();
    out.push({ name: ITEM_KO[low] || ITEM_KO[low.slice(0, 6)] || m[1], box: Number(m[2]) });
  }
  return out;
}

/**
 * 카카오톡 내보내기(txt) 본문을 선적 공지 단위로 파싱한다.
 * @returns {{ mentions: object[], shipments: object[], years: number[] }}
 */
export function parseKakaoFlightSchedule(text, { fromYear = 2026 } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const messages = [];
  let date = null; let cur = null;
  for (const line of lines) {
    const d = line.match(DATE_LINE);
    if (d) { date = { y: Number(d[1]), m: Number(d[2]), d: Number(d[3]) }; cur = null; continue; }
    if (!date || date.y < fromYear) continue;
    const mm = line.match(MSG_LINE);
    if (mm) { cur = { date, sender: mm[1], text: mm[5] }; messages.push(cur); }
    else if (cur) cur.text += `\n${line}`;
  }
  const mentions = [];
  for (const msg of messages) {
    const body = msg.text.replace(INLINE, (_, item, maj, mi, suf) => `\n${maj}-${mi}${suf}차 ${item}`);
    const heads = [];
    for (const m of body.matchAll(HDR_BRACKET)) heads.push({ s: m.index, e: m.index + m[0].length, maj: m[1], mi: m[2], suf: m[3], rest: `${m[4]} ${m[5] || ''}` });
    for (const m of body.matchAll(HDR_PLAIN)) {
      if (heads.some(h => h.s <= m.index && m.index < h.e)) continue;
      heads.push({ s: m.index, e: m.index + m[0].length, maj: m[1], mi: m[2], suf: m[3], rest: `${m[4]} ${m[5] || ''}` });
    }
    heads.sort((a, b) => a.s - b.s);
    heads.forEach((h, k) => {
      const country = normalizeCountry(h.rest);
      if (!country) return;
      const block = body.slice(h.e, k + 1 < heads.length ? heads[k + 1].s : body.length);
      const weekKey = normalizeWeekKey(`${h.maj}-${h.mi}`);
      const subWeek = `${Number(h.maj)}-${Number(h.mi)}${h.suf.toUpperCase()}`;
      const item = normalizeItem(h.rest, country);
      const am = block.match(ARRIVAL);
      const arrival = am ? `${msg.date.y}-${String(am[1]).padStart(2, '0')}-${String(am[2]).padStart(2, '0')}` : '';
      const base = { year: msg.date.y, weekKey, subWeek, country, item, header: h.rest.trim(), arrival, messageDate: `${msg.date.y}-${String(msg.date.m).padStart(2, '0')}-${String(msg.date.d).padStart(2, '0')}` };
      const awbs = [...block.matchAll(AWB_LINE)];
      if (awbs.length) {
        awbs.forEach((m, j) => {
          let seg = block.slice(m.index + m[0].length, j + 1 < awbs.length ? awbs[j + 1].index : block.length);
          if (j === 0) seg = block.slice(0, m.index) + seg;
          let flight = m[2] || ''; let box = m[3] || '';
          if (/^\d+$/.test(flight) && !box) { box = flight; flight = ''; }
          const items = itemsIn(seg);
          const fixedItem = country === '콜롬비아' && item === '카장' && items.length && items.every(i => i.name === '수국') ? '수국' : item;
          mentions.push({ ...base, item: fixedItem, awbRaw: m[1].trim(), awbKey: normalizeAwb(m[1]), flight: flight.toUpperCase(), box: /^\d+$/.test(box) ? Number(box) : null, items });
        });
      } else {
        const items = itemsIn(block);
        const pm = block.match(PENDING_BOX);
        mentions.push({ ...base, awbRaw: pm ? '(확인중)' : '', awbKey: '', flight: '', box: pm ? Number(pm[1]) : null, items });
      }
    });
  }
  // AWB 단위 통합
  const byKey = new Map();
  for (const m of mentions) {
    const key = m.awbKey ? `AWB:${m.awbKey}` : `NOAWB:${m.subWeek}|${m.country}|${m.item}|${m.awbRaw}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  let shipments = [];
  for (const [key, group] of byKey) {
    const boxes = group.map(g => g.box).filter(b => b != null);
    const arrivals = [...new Set(group.map(g => g.arrival).filter(Boolean))].sort();
    const last = group[group.length - 1];
    const flags = [];
    if (new Set(boxes).size > 1) flags.push(`박스수 변동 ${[...new Set(boxes)].join('→')}`);
    if (arrivals.length > 1) flags.push(`도착일 변경 ${arrivals.join('→')} (연착)`);
    const withItems = [...group].reverse().find(g => g.items.length);
    shipments.push({
      year: last.year, weekKey: last.weekKey, subWeek: last.subWeek, country: last.country, item: last.item,
      awbKey: last.awbKey, awbRaw: last.awbRaw, flight: [...group].reverse().find(g => g.flight)?.flight || '',
      box: boxes.length ? boxes[boxes.length - 1] : null, arrival: arrivals[arrivals.length - 1] || '',
      mentionCount: group.length, items: withItems ? withItems.items : [], flags, duplicate: false, estimated: false, noAwb: !last.awbKey,
    });
  }
  // AWB 없는 사전공지 흡수 (같은 차수·국가·품목에 AWB 건이 있으면 제거)
  const hasAwb = new Set(shipments.filter(s => s.awbKey).map(s => `${s.weekKey}|${s.country}|${s.item}`));
  shipments = shipments.filter(s => s.awbKey || !hasAwb.has(`${s.weekKey}|${s.country}|${s.item}`) || (s.box != null && s.awbRaw !== '(확인중)'));
  // AWB 미기재 + 품목내역 → 품목합 추정
  for (const s of shipments) {
    if (!s.awbKey && s.box == null && s.items.length) { s.box = s.items.reduce((a, i) => a + i.box, 0); s.estimated = true; s.flags.push('AWB 미기재 → 품목합 추정'); }
  }
  // 같은 차수·국가·품목 안에 AWB 다른 선적이 박스수까지 같으면 중복 의심(두 번째 이후 제외)
  const seen = new Map();
  for (const s of shipments.filter(x => x.awbKey && x.box != null).sort((a, b) => a.messageDate < b.messageDate ? -1 : 1)) {
    const k = `${s.subWeek}|${s.country}|${s.item}|${s.box}`;
    if (seen.has(k)) { s.duplicate = true; s.flags.push(`중복 의심(AWB ${seen.get(k)} 와 박스 동일)`); }
    else seen.set(k, s.awbRaw);
  }
  const years = [...new Set(shipments.map(s => s.year))].sort();
  return { mentions, shipments, years };
}

function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) <= 2 && (a.includes(b) || b.includes(a))) return true;
  if (a.length === b.length) { let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++; return diff <= 1; }
  return false;
}

/**
 * 웹 입고 + 카톡 선적을 합쳐 최종 박스를 정한다.
 * warehouse: [{ weekKey, awb, farmName, country, boxQty, roseNoBoxBunch, lines }] (WarehouseMaster 1행 = 1인보이스)
 * kakao:     parseKakaoFlightSchedule().shipments 또는 WebFlightScheduleBox 행
 */
export function buildBoxByCountry({ warehouse = [], kakao = [] } = {}) {
  const web = new Map();
  for (const row of warehouse) {
    const country = fixCountryByFarm(COUNTRY_ALIASES[row.country] || row.country || '미상', row.farmName);
    if (country === '국내') continue;
    const awbKey = normalizeAwb(row.awb);
    const key = awbKey || `WEB-NOAWB:${row.weekKey}|${row.farmName}`;
    if (!web.has(key)) web.set(key, { awbKey, weekKey: normalizeWeekKey(row.weekKey) || row.weekKey, countries: new Map(), farms: new Set(), box: 0, roseNoBoxBunch: 0, lines: 0, inputDate: row.inputDate || '' });
    const w = web.get(key);
    w.countries.set(country, (w.countries.get(country) || 0) + (Number(row.boxQty) || 0) + 0.001);
    w.farms.add(row.farmName || '');
    w.box += Number(row.boxQty) || 0;
    w.roseNoBoxBunch += Number(row.roseNoBoxBunch) || 0;
    w.lines += Number(row.lines) || 0;
    if (row.inputDate && (!w.inputDate || row.inputDate < w.inputDate)) w.inputDate = row.inputDate;
  }
  for (const w of web.values()) { const c = [...w.countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; w.country = !c || c === '미상' ? '기타' : c; }

  const kakaoRows = kakao.filter(k => !k.duplicate);
  const kakaoByAwb = new Map(kakaoRows.filter(k => k.awbKey).map(k => [k.awbKey, k]));
  // 웹 AWB 표기오류 보정: 같은 차수·국가에서 근접한 카톡 AWB로 매칭
  for (const w of web.values()) {
    if (!w.awbKey || kakaoByAwb.has(w.awbKey)) continue;
    const cand = kakaoRows.find(k => k.awbKey && k.weekKey === w.weekKey && k.country === w.country && near(w.awbKey, k.awbKey));
    if (cand) { w.awbFixedFrom = w.awbKey; w.awbKey = cand.awbKey; }
  }
  const webByAwb = new Map([...web.values()].filter(w => w.awbKey).map(w => [w.awbKey, w]));

  const rows = [];
  const used = new Set();
  for (const k of kakaoRows) {
    if (!k.awbKey) continue;
    const w = webByAwb.get(k.awbKey);
    const kbox = Number(k.box) || 0;
    const row = { weekKey: k.weekKey, subWeek: k.subWeek || weekLabel(k.weekKey), country: k.country, item: k.item || '', awb: k.awbRaw || k.awbKey, kakaoBox: kbox, webBox: w ? w.box : null, arrival: k.arrival || '', farms: w ? [...w.farms].filter(Boolean).join(', ') : '', note: '' };
    if (!w) { row.finalBox = kbox; row.source = '카톡(웹 미입고)'; row.needsCheck = true; }
    else {
      used.add(k.awbKey);
      const wbox = w.box;
      if (w.awbFixedFrom) row.note = `웹 AWB 표기 ${w.awbFixedFrom} → 카톡 AWB로 매칭`;
      if (wbox <= 0) { row.finalBox = kbox; row.source = kbox ? '카톡(웹 박스 미입력)' : '박스 없음'; }
      else if (BOX_COUNTRIES.has(k.country) && w.roseNoBoxBunch > 0 && kbox > wbox && Math.abs(kbox - wbox - w.roseNoBoxBunch / 10) <= 3) {
        row.finalBox = kbox; row.source = '카톡(웹 장미 박스 미입력 보정)'; row.note = `웹 ${wbox}은 장미 ${w.roseNoBoxBunch}단 박스0 → 카톡 ${kbox} 채택`;
      } else if (!BOX_COUNTRIES.has(k.country)) { row.finalBox = kbox || wbox; row.source = kbox ? '카톡(웹 박스 단위 상이)' : '웹(전산)'; }
      else {
        row.finalBox = wbox; row.source = '웹(전산)';
        if (kbox && Math.abs(kbox - wbox) / Math.max(kbox, 1) > 0.05) row.note = `카톡 ${kbox} ↔ 웹 ${wbox} (차이 ${kbox - wbox > 0 ? '+' : ''}${kbox - wbox})`;
      }
    }
    rows.push(row);
  }
  for (const w of web.values()) {
    if (w.awbKey && used.has(w.awbKey)) continue;
    rows.push({ weekKey: w.weekKey, subWeek: weekLabel(w.weekKey), country: w.country, item: '', awb: w.awbKey || '(AWB 없음)', kakaoBox: null, webBox: w.box, finalBox: w.box, source: '웹(카톡 공지 없음)', arrival: w.inputDate || '', farms: [...w.farms].filter(Boolean).join(', '), note: '' });
  }
  // ⑤ AWB 미기재 추정 공지: 같은 차수·국가 선적이 전혀 없을 때만
  for (const k of kakaoRows.filter(x => !x.awbKey && x.box != null)) {
    if (rows.some(r => r.weekKey === k.weekKey && r.country === k.country)) continue;
    rows.push({ weekKey: k.weekKey, subWeek: k.subWeek || weekLabel(k.weekKey), country: k.country, item: k.item || '', awb: '(미기재)', kakaoBox: k.box, webBox: null, finalBox: k.box, source: '카톡(AWB 미기재·품목합 추정)', arrival: k.arrival || '', farms: '', note: '웹 입고 매칭 안 됨', needsCheck: true });
  }
  rows.sort((a, b) => a.weekKey.localeCompare(b.weekKey) || a.country.localeCompare(b.country, 'ko') || String(a.awb).localeCompare(String(b.awb)));

  const totals = new Map();
  for (const r of rows) totals.set(r.country, (totals.get(r.country) || 0) + (r.finalBox || 0));
  const countries = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const pivot = (keyFn) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyFn(r); if (!key) continue;
      if (!map.has(key)) map.set(key, { key, total: 0, byCountry: Object.fromEntries(countries.map(c => [c, 0])) });
      const p = map.get(key);
      if (!(r.country in p.byCountry)) p.byCountry[r.country] = 0;
      p.byCountry[r.country] += r.finalBox || 0; p.total += r.finalBox || 0;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  };
  const byWeek = pivot(r => r.weekKey).map(p => ({ ...p, label: weekLabel(p.key) }));
  const byMajor = pivot(r => r.weekKey.slice(0, 2)).map(p => ({ ...p, label: `${Number(p.key)}차` }));
  const byMonth = pivot(r => (r.arrival || '').slice(0, 7)).map(p => ({ ...p, label: p.key }));
  const grand = Object.fromEntries(countries.map(c => [c, totals.get(c) || 0]));
  return { rows, countries, byWeek, byMajor, byMonth, grandTotal: { byCountry: grand, total: rows.reduce((a, r) => a + (r.finalBox || 0), 0) }, sources: countBy(rows, r => r.source), needsCheck: rows.filter(r => r.needsCheck) };
}

function countBy(list, fn) {
  const m = {};
  for (const x of list) { const k = fn(x); if (!m[k]) m[k] = { count: 0, box: 0 }; m[k].count++; m[k].box += x.finalBox || 0; }
  return m;
}
