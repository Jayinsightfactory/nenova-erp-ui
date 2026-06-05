// pages/api/admin/workflow.js
// 직원간 업무플로우 분석 — nenovakakao 기획(pipeline_config + flow/lifecycle 분석) 풀반영.
//   카카오 Google Sheet(이벤트로그/비즈니스이벤트/의사결정추적) + nenova.exe(ViewOrder) 매칭.
//   GET ?week=&room=&stage=
// ⚠️ 읽기 전용.

import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { getKakaoSheetId, readSheetValues } from '../../../lib/googleSheets';
import { scoreMatch } from '../../../lib/displayName';
import { stageOfRoom, stageName, personRole, STAGE_ORDER, EVENT_TYPES } from '../../../lib/workflowConfig';

const LOG_RANGE = '이벤트로그!A:F';
const BIZ_RANGE = '비즈니스이벤트!A:P';
const DEC_RANGE = '의사결정추적!A:K';

const norm = v => String(v ?? '').trim();
const majorWeek = v => { const m = norm(v).match(/(\d{1,3})/); return m ? m[1] : ''; };
const parseQty = v => { const n = Number(String(v || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0); return Number.isFinite(n) ? n : 0; };

// '오전 10:19' / '오후 3:46' / '2026-06-05 10:19' → 분(0~1439). 실패 null.
function parseMin(t) {
  const s = norm(t);
  let m = s.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (m) { let h = +m[2]; if (m[1] === '오후' && h !== 12) h += 12; if (m[1] === '오전' && h === 12) h = 0; return h * 60 + +m[3]; }
  m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  return null;
}

function rowToEvent(r) {
  return {
    eventId: norm(r[0]), time: norm(r[1]), eventType: norm(r[2]), week: norm(r[3]), product: norm(r[4]),
    variety: norm(r[5]), quantity: parseQty(r[6]), unit: norm(r[7]) || '개', direction: norm(r[8]),
    customer: norm(r[9]), room: norm(r[10]), pipeline: norm(r[11]) || stageOfRoom(r[10]),
    sender: norm(r[12]), summary: norm(r[13]), relId: norm(r[14]), triggerMsgId: norm(r[15]),
  };
}
function rowToLog(r) { return { time: norm(r[0]), room: norm(r[1]), pipeline: norm(r[2]), sender: norm(r[3]), text: norm(r[4]), msgId: norm(r[5]) }; }
function rowToDecision(r) {
  return {
    issueId: norm(r[0]), time: norm(r[1]), room: norm(r[2]), pipeline: norm(r[3]) || stageOfRoom(r[2]),
    content: norm(r[4]), responder: norm(r[5]), response: norm(r[6]), responseTime: norm(r[7]),
    durationMin: parseQty(r[8]), result: norm(r[9]) || '정보없음', relId: norm(r[10]),
  };
}

const prodLabel = e => [e.product, e.variety].filter(Boolean).join(' ') || '품목미분류';
function bump(map, key, qty = 0) { const k = key || '미상'; const c = map.get(k) || { key: k, count: 0, qty: 0 }; c.count += 1; c.qty += qty; map.set(k, c); }
const vals = m => [...m.values()].sort((a, b) => b.count - a.count);
const REQUEST_RE = /추가|취소|변경|발주|요청|ORDER/i;

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
  const qWeek = majorWeek(req.query.week), qRoom = norm(req.query.room), qStage = norm(req.query.stage);

  // ── 1) 카카오 시트 ──
  let logs = [], events = [], decisions = [], kakaoAvailable = true, kakaoError = '';
  try {
    const id = getKakaoSheetId();
    const [lv, bv, dv] = await Promise.all([
      readSheetValues({ spreadsheetId: id, range: LOG_RANGE }).catch(() => []),
      readSheetValues({ spreadsheetId: id, range: BIZ_RANGE }),
      readSheetValues({ spreadsheetId: id, range: DEC_RANGE }).catch(() => []),
    ]);
    // 시트가 커져도 안 느려지게 최근 N행만 처리(append-only라 뒤쪽이 최신).
    logs = lv.slice(1).slice(-15000).map(rowToLog).filter(l => l.sender || l.text);
    events = bv.slice(1).slice(-10000).map(rowToEvent).filter(e => e.sender || e.product || e.eventType);
    decisions = dv.slice(1).slice(-5000).map(rowToDecision).filter(d => d.issueId || d.content);
  } catch (e) { kakaoAvailable = false; kakaoError = e.message; }

  const matchFilters = x => (!qWeek || majorWeek(x.week) === qWeek) && (!qRoom || x.room.includes(qRoom)) && (!qStage || (x.pipeline || stageOfRoom(x.room)) === qStage);
  const ev = events.filter(matchFilters);
  const lg = logs.filter(l => (!qRoom || l.room.includes(qRoom)) && (!qStage || (l.pipeline || stageOfRoom(l.room)) === qStage));

  // ── 2) 집계 ──
  const bySender = new Map(), byWeek = new Map(), byRoom = new Map(), byType = new Map(), byStage = new Map();
  for (const e of ev) {
    bump(bySender, e.sender, e.quantity);
    bump(byWeek, majorWeek(e.week) ? `${majorWeek(e.week)}차` : '미상', e.quantity);
    bump(byRoom, e.room, e.quantity);
    bump(byType, e.eventType ? `${e.eventType}${EVENT_TYPES[e.eventType] ? `(${EVENT_TYPES[e.eventType]})` : ''}` : '기타', e.quantity);
    bump(byStage, stageName(e.pipeline || stageOfRoom(e.room)), e.quantity);
  }

  // ── 3) 흐름분석 (_flow_analysis.py) ──
  // 3-1 발신자쌍 응답시간 + 방별
  const roomLogs = new Map();
  for (const l of lg) { if (!roomLogs.has(l.room)) roomLogs.set(l.room, []); roomLogs.get(l.room).push(l); }
  const pairMap = new Map(); const roomResp = [];
  for (const [room, msgs] of roomLogs) {
    const deltas = [];
    for (let i = 1; i < msgs.length; i++) {
      const p = msgs[i - 1], c = msgs[i];
      if (p.sender && c.sender && p.sender !== c.sender) {
        const a = parseMin(p.time), b = parseMin(c.time);
        if (a != null && b != null && b - a >= 0) {
          deltas.push(b - a);
          const k = `${p.sender}→${c.sender}`;
          if (!pairMap.has(k)) pairMap.set(k, []);
          pairMap.get(k).push(b - a);
        }
      }
    }
    if (deltas.length) roomResp.push({ room, turns: deltas.length, avgMin: +(deltas.reduce((x, y) => x + y, 0) / deltas.length).toFixed(1), maxMin: Math.max(...deltas) });
  }
  const responsePairs = [...pairMap.entries()].map(([k, ds]) => { const [from, to] = k.split('→'); return { from, to, turns: ds.length, avgMin: +(ds.reduce((x, y) => x + y, 0) / ds.length).toFixed(1), maxMin: Math.max(...ds) }; })
    .sort((a, b) => b.turns - a.turns).slice(0, 30);
  roomResp.sort((a, b) => b.turns - a.turns);

  // 3-2 스레드 (방+차수+품목)
  const threadMap = new Map();
  for (const e of ev) {
    if (!e.week && !e.product) continue;
    const k = `${e.room}|${majorWeek(e.week)}|${e.product}`;
    if (!threadMap.has(k)) threadMap.set(k, []);
    threadMap.get(k).push(e);
  }
  const threads = [...threadMap.values()].map(evs => {
    const parts = [...new Set(evs.map(e => e.sender).filter(Boolean))];
    const mins = evs.map(e => parseMin(e.time)).filter(x => x != null);
    return {
      room: evs[0].room, week: majorWeek(evs[0].week), product: evs[0].product, msgs: evs.length,
      participants: parts, types: [...new Set(evs.map(e => e.eventType).filter(Boolean))],
      durationMin: mins.length >= 2 ? Math.max(...mins) - Math.min(...mins) : null,
    };
  }).sort((a, b) => b.msgs - a.msgs).slice(0, 60);

  // 3-3 방간 정보전달 (차수+품목 → 여러 방)
  const topicRooms = new Map();
  for (const e of ev) {
    if (!majorWeek(e.week) || !e.product) continue;
    const k = `${majorWeek(e.week)}|${e.product}`;
    if (!topicRooms.has(k)) topicRooms.set(k, []);
    topicRooms.get(k).push(e);
  }
  const crossRoom = [];
  for (const [k, entries] of topicRooms) {
    const roomFirst = new Map();
    for (const e of entries) { const t = parseMin(e.time); if (t == null) continue; if (!roomFirst.has(e.room) || t < roomFirst.get(e.room).t) roomFirst.set(e.room, { t, time: e.time, sender: e.sender }); }
    if (roomFirst.size < 2) continue;
    const sorted = [...roomFirst.entries()].sort((a, b) => a[1].t - b[1].t);
    const [oRoom, oInfo] = sorted[0]; const [week, product] = k.split('|');
    crossRoom.push({ week, product, fromRoom: oRoom, firstSender: oInfo.sender, rooms: roomFirst.size,
      transfers: sorted.slice(1).map(([rm, inf]) => ({ toRoom: rm, by: inf.sender, delayMin: inf.t - oInfo.t })) });
  }
  crossRoom.sort((a, b) => b.rooms - a.rooms);

  // 3-4 무응답 구간 (INQUIRY 후 같은 방 다른 발신자 응답 5분+ 또는 무응답)
  const noResponse = [];
  for (const inq of ev.filter(e => e.eventType === 'INQUIRY')) {
    const it = parseMin(inq.time); if (it == null) continue;
    const msgs = roomLogs.get(inq.room) || [];
    let resp = null;
    for (const m of msgs) { const mt = parseMin(m.time); if (mt != null && mt > it && m.sender && m.sender !== inq.sender) { resp = m; break; } }
    if (!resp) noResponse.push({ room: inq.room, asker: inq.sender, time: inq.time, summary: inq.summary, waitMin: '무응답', week: majorWeek(inq.week), product: inq.product });
    else { const d = parseMin(resp.time) - it; if (d >= 5) noResponse.push({ room: inq.room, asker: inq.sender, time: inq.time, summary: inq.summary, responder: resp.sender, waitMin: d, week: majorWeek(inq.week), product: inq.product }); }
  }
  noResponse.sort((a, b) => (b.waitMin === '무응답' ? 1e9 : b.waitMin) - (a.waitMin === '무응답' ? 1e9 : a.waitMin));

  // ── 4) 라이프사이클 (_lifecycle_analysis.py) ──
  const chasuEv = new Map();
  for (const e of ev) { const c = majorWeek(e.week); if (!c) continue; if (!chasuEv.has(c)) chasuEv.set(c, []); chasuEv.get(c).push(e); }
  const byChasu = [...chasuEv.entries()].map(([c, evs]) => {
    const tc = {}; evs.forEach(e => { tc[e.eventType] = (tc[e.eventType] || 0) + 1; });
    return { week: c, total: evs.length, change: tc.ORDER_CHANGE || 0, defect: tc.DEFECT || 0, types: tc };
  }).sort((a, b) => Number(a.week) - Number(b.week));

  // 품목별 불량률
  const ITEMS = ['카네이션', '수국', '장미', '루스커스', '튤립'];
  const itemDefects = ITEMS.map(it => {
    const all = ev.filter(e => e.product === it || (e.product !== it && e.summary.includes(it)));
    const defects = all.filter(e => e.eventType === 'DEFECT');
    const traderDef = {}; defects.forEach(d => { if (d.customer) traderDef[d.customer] = (traderDef[d.customer] || 0) + 1; });
    return { item: it, mentions: all.length, defects: defects.length, rate: all.length ? +(defects.length / all.length * 100).toFixed(1) : 0, byTrader: traderDef };
  }).filter(x => x.mentions > 0).sort((a, b) => b.defects - a.defects);

  // 주문변경→불량 전환율
  const defectPairs = new Set();
  ev.filter(e => e.eventType === 'DEFECT').forEach(d => { const c = majorWeek(d.week); if (c) { defectPairs.add(`${c}|${d.product}`); defectPairs.add(`${c}|`); } });
  const changePairs = new Map();
  ev.filter(e => e.eventType === 'ORDER_CHANGE').forEach(o => { const c = majorWeek(o.week); if (c) { const k = `${c}|${o.product}`; if (!changePairs.has(k)) changePairs.set(k, 0); changePairs.set(k, changePairs.get(k) + 1); } });
  let changeTotal = 0, changeDefect = 0; const conversions = [];
  for (const [k, cnt] of changePairs) { changeTotal++; const [c, p] = k.split('|'); const has = defectPairs.has(k) || defectPairs.has(`${c}|`); if (has) { changeDefect++; conversions.push({ week: c, product: p, changes: cnt }); } }
  const conversionRate = changeTotal ? +(changeDefect / changeTotal * 100).toFixed(1) : 0;

  // 미해결 이슈 체인
  const unresolved = decisions.filter(d => /미해결|미처리|보류|진행/.test(d.result) || d.result === '정보없음');
  const issuesByStage = new Map(), issuesByRoom = new Map();
  for (const u of unresolved) { bump(issuesByStage, stageName(u.pipeline), 0); bump(issuesByRoom, u.room, 0); }
  const resolvedCnt = decisions.length - unresolved.length;

  // ── 5) 직원별 (역할/단계 + 활동 + 응답자) ──
  const respondCount = new Map(); decisions.forEach(d => { if (d.responder) respondCount.set(d.responder, (respondCount.get(d.responder) || 0) + 1); });
  const people = [...new Set([...ev.map(e => e.sender), ...decisions.map(d => d.responder)].filter(Boolean))].map(name => {
    const role = personRole(name);
    const acts = ev.filter(e => e.sender === name);
    return { name, role: role?.role || '', stage: role ? stageName(role.stage) : (acts[0] ? stageName(stageOfRoom(acts[0].room)) : ''),
      events: acts.length, requests: acts.filter(e => REQUEST_RE.test(e.eventType) || REQUEST_RE.test(e.summary)).length,
      defectsReported: acts.filter(e => e.eventType === 'DEFECT').length, responses: respondCount.get(name) || 0 };
  }).sort((a, b) => (b.events + b.responses) - (a.events + a.responses));

  // ── 6) 파이프라인 단계 현황 ──
  const stageBoard = STAGE_ORDER.map(key => {
    const stEv = ev.filter(e => (e.pipeline || stageOfRoom(e.room)) === key);
    const stIssues = unresolved.filter(u => u.pipeline === key);
    return { key, name: stageName(key), events: stEv.length, change: stEv.filter(e => e.eventType === 'ORDER_CHANGE').length, defect: stEv.filter(e => e.eventType === 'DEFECT').length, unresolved: stIssues.length };
  });

  // ── 7) nenova.exe(ViewOrder) 요청→처리 매칭 ──
  let orders = []; let sqlSkipped = false;
  const weeksInPlay = [...new Set(ev.map(e => majorWeek(e.week)).filter(w => /^\d{1,3}$/.test(w)))];
  const sqlWeek = (qWeek || '').padStart(2, '0');
  // ViewOrder(무거운 뷰)는 "차수 선택 시 그 한 차수만" 조회한다. 전체 조회는 타임아웃 → 전산매칭 보류.
  if (/^\d{2}$/.test(sqlWeek)) {
    try {
      const r = await query(
        `SELECT TOP 20000 vo.OrderWeek, vo.Manager, ui.UserName AS ManagerName, vo.CustName, vo.ProdName,
                ISNULL(px.DisplayName, vo.ProdName) AS DisplayName, vo.FlowerName, vo.CounName,
                CONVERT(NVARCHAR(16), vo.OrderDtm, 120) AS OrderDtm
         FROM ViewOrder vo LEFT JOIN Product px ON vo.ProdKey = px.ProdKey
         LEFT JOIN UserInfo ui ON ui.UserID = vo.Manager
         WHERE vo.OrderWeek LIKE '${sqlWeek}%'`);
      orders = r.recordset || [];
    } catch { /* SQL 보조 — 실패해도 진행 */ }
  } else {
    sqlSkipped = true;  // 차수 미선택 → 전산 매칭 생략(빠른 로딩)
  }
  const ordersByWeek = new Map(); orders.forEach(o => { const w = majorWeek(o.OrderWeek).padStart(2, '0'); if (!ordersByWeek.has(w)) ordersByWeek.set(w, []); ordersByWeek.get(w).push(o); });
  const tracking = []; const flowEdge = new Map();
  for (const e of ev) {
    if (!REQUEST_RE.test(e.eventType) && !REQUEST_RE.test(e.summary)) continue;
    const cands = ordersByWeek.get(majorWeek(e.week).padStart(2, '0')) || [];
    let best = null, bs = 0; const input = prodLabel(e);
    for (const o of cands) {
      const ps = scoreMatch(input, { ProdName: o.ProdName, DisplayName: o.DisplayName, FlowerName: o.FlowerName, CounName: o.CounName });
      const custOk = e.customer && o.CustName && (o.CustName.includes(e.customer) || e.customer.includes(o.CustName));
      const sc = ps + (custOk ? 20 : 0); if (sc > bs) { bs = sc; best = o; }
    }
    const processed = bs >= 72; const by = processed ? (best.ManagerName || best.Manager || '') : '';
    tracking.push({ time: e.time, sender: e.sender, room: e.room, week: e.week, eventType: e.eventType, product: input,
      quantity: e.quantity, unit: e.unit, direction: e.direction, customer: e.customer, processed, processedBy: by, matchScore: Math.round(bs),
      matchedOrder: processed ? { custName: best.CustName, prodName: best.DisplayName, orderDtm: best.OrderDtm } : null });
    if (processed && e.sender && by) { const k = `${e.sender}→${by}`; flowEdge.set(k, (flowEdge.get(k) || 0) + 1); }
  }

  // ── 8) 네트워크 ──
  const coEdges = new Map();
  for (const evs of threadMap.values()) {
    const ps = [...new Set(evs.map(e => e.sender).filter(Boolean))];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const k = [ps[i], ps[j]].sort().join('↔'); coEdges.set(k, (coEdges.get(k) || 0) + 1); }
  }
  const network = {
    flow: [...flowEdge.entries()].map(([k, v]) => { const [from, to] = k.split('→'); return { from, to, count: v }; }),
    cowork: [...coEdges.entries()].map(([k, v]) => { const [a, b] = k.split('↔'); return { a, b, count: v }; }).sort((x, y) => y.count - x.count).slice(0, 40),
  };

  const processedCnt = tracking.filter(t => t.processed).length;
  return res.status(200).json({
    success: true, kakaoAvailable, kakaoError, sqlSkipped, filters: { week: qWeek, room: qRoom, stage: qStage },
    totals: { logs: lg.length, events: ev.length, requests: tracking.length, processed: processedCnt, unprocessed: tracking.length - processedCnt,
      senders: bySender.size, issues: decisions.length, unresolved: unresolved.length, resolved: resolvedCnt, orders: orders.length },
    bySender: vals(bySender), byWeek: [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key)), byRoom: vals(byRoom), byType: vals(byType), byStage: vals(byStage),
    stageBoard,
    flow: { responsePairs, roomResp: roomResp.slice(0, 20), threads, crossRoom: crossRoom.slice(0, 40), noResponse: noResponse.slice(0, 60) },
    lifecycle: { byChasu, itemDefects, conversion: { total: changeTotal, withDefect: changeDefect, rate: conversionRate, detail: conversions.sort((a, b) => b.changes - a.changes).slice(0, 30) } },
    issues: { total: decisions.length, unresolved: unresolved.length, resolved: resolvedCnt, byStage: vals(issuesByStage), byRoom: vals(issuesByRoom), list: unresolved.slice(0, 200) },
    people, tracking: tracking.sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 300), network, weeksInPlay,
  });
  } catch (e) {
    return res.status(200).json({ success: false, error: String(e?.message || e) });
  }
}

export default withAuth(handler);
