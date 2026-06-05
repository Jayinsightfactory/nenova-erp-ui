// pages/api/admin/workflow.js
// 직원간 업무플로우 분석 — 카카오(nenovakakao) 대화 이벤트 + nenova.exe(ViewOrder) 매칭.
//   GET ?week=&room=&days=
//   반환: 집계(발신자/차수/방/유형), 요청→처리 매칭, 직원 네트워크, 이슈(의사결정추적).
// ⚠️ 읽기 전용. Google Sheet + ViewOrder 만 읽는다(쓰기 없음).

import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { getKakaoSheetId, readSheetValues } from '../../../lib/googleSheets';
import { scoreMatch } from '../../../lib/displayName';

const BUSINESS_EVENT_RANGE = '비즈니스이벤트!A:P';
const DECISION_RANGE = '의사결정추적!A:Z';

const norm = v => String(v ?? '').trim();
const majorWeek = v => {
  const m = norm(v).match(/(\d{1,2})/);
  return m ? m[1].padStart(2, '0') : '';
};
const parseQty = v => {
  const n = Number(String(v || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(n) ? n : 0;
};

function rowToEvent(row) {
  return {
    eventId: norm(row[0]), time: norm(row[1]), eventType: norm(row[2]), week: norm(row[3]),
    product: norm(row[4]), variety: norm(row[5]), quantity: parseQty(row[6]), unit: norm(row[7]) || '개',
    direction: norm(row[8]), supplier: norm(row[9]), room: norm(row[10]), pipeline: norm(row[11]),
    sender: norm(row[12]), summary: norm(row[13]), threadId: norm(row[14]), messageId: norm(row[15]),
  };
}

const prodLabel = e => [e.product, e.variety].filter(Boolean).join(' ') || '품목미분류';

function bump(map, key, qty = 0) {
  const k = key || '미상';
  const cur = map.get(k) || { key: k, count: 0, qty: 0 };
  cur.count += 1; cur.qty += qty; map.set(k, cur);
}
const sortedVals = m => [...m.values()].sort((a, b) => b.count - a.count);

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });

  const qWeek = majorWeek(req.query.week);
  const qRoom = norm(req.query.room);

  // ── 1) 카카오 이벤트 (graceful: 시트 미연동이면 빈 데이터 + 안내)
  let events = [], decisions = [], kakaoAvailable = true, kakaoError = '';
  try {
    const sheetId = getKakaoSheetId();
    const [evVals, dcVals] = await Promise.all([
      readSheetValues({ spreadsheetId: sheetId, range: BUSINESS_EVENT_RANGE }),
      readSheetValues({ spreadsheetId: sheetId, range: DECISION_RANGE }).catch(() => []),
    ]);
    events = evVals.slice(1).map(rowToEvent).filter(e => e.sender || e.product);
    const dh = (dcVals[0] || []).map(norm);
    decisions = dcVals.slice(1).map(r => {
      const o = {}; dh.forEach((h, i) => { o[h || `col${i}`] = norm(r[i]); }); return o;
    });
  } catch (e) { kakaoAvailable = false; kakaoError = e.message; }

  let filtered = events;
  if (qWeek) filtered = filtered.filter(e => majorWeek(e.week) === qWeek);
  if (qRoom) filtered = filtered.filter(e => e.room.includes(qRoom));

  // ── 2) ViewOrder (요청→처리 매칭용). 해당 차수 주문 + 담당자명.
  let orders = [];
  const weeksInPlay = [...new Set(filtered.map(e => majorWeek(e.week)).filter(Boolean))];
  try {
    // weeksInPlay 는 majorWeek(숫자만, 2자리)라 인젝션 안전 → 인라인.
    const safeWeeks = weeksInPlay.filter(w => /^\d{2}$/.test(w));
    let where = 'WHERE 1=1';
    if (safeWeeks.length) {
      where += ` AND LEFT(vo.OrderWeek, 2) IN (${safeWeeks.map(w => `'${w}'`).join(',')})`;
    }
    const r = await query(
      `SELECT vo.OrderWeek, vo.Manager, ui.UserName AS ManagerName, vo.CustName,
              vo.ProdName, ISNULL(px.DisplayName, vo.ProdName) AS DisplayName, vo.FlowerName, vo.CounName,
              CONVERT(NVARCHAR(16), vo.OrderDtm, 120) AS OrderDtm
       FROM ViewOrder vo
       LEFT JOIN Product px ON vo.ProdKey = px.ProdKey
       LEFT JOIN UserInfo ui ON ui.UserID = vo.Manager
       ${where}`
    );
    orders = r.recordset || [];
  } catch (e) { /* SQL 매칭은 보조 — 실패해도 진행 */ }

  // 차수별 주문 인덱스
  const ordersByWeek = new Map();
  for (const o of orders) {
    const w = majorWeek(o.OrderWeek);
    if (!ordersByWeek.has(w)) ordersByWeek.set(w, []);
    ordersByWeek.get(w).push(o);
  }

  // ── 3) 요청→처리 매칭 (카카오 발주/변경 요청이 ViewOrder 에 반영됐나)
  const REQUEST_TYPES = /추가|취소|변경|발주|요청/;
  const tracking = [];
  const matchedSenderToMgr = new Map();   // "발신자→처리담당자" 엣지
  for (const e of filtered) {
    if (!REQUEST_TYPES.test(e.eventType) && !REQUEST_TYPES.test(e.summary)) continue;
    const cands = ordersByWeek.get(majorWeek(e.week)) || [];
    let best = null, bestScore = 0;
    const input = prodLabel(e);
    for (const o of cands) {
      const ps = scoreMatch(input, { ProdName: o.ProdName, DisplayName: o.DisplayName, FlowerName: o.FlowerName, CounName: o.CounName });
      const custOk = e.supplier && o.CustName ? (o.CustName.includes(e.supplier) || e.supplier.includes(o.CustName)) : false;
      const sc = ps + (custOk ? 20 : 0);
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    const processed = bestScore >= 72;
    const processedBy = processed ? (best.ManagerName || best.Manager || '') : '';
    tracking.push({
      time: e.time, sender: e.sender, room: e.room, week: e.week, eventType: e.eventType,
      product: input, quantity: e.quantity, unit: e.unit, direction: e.direction, supplier: e.supplier,
      processed, processedBy, matchScore: Math.round(bestScore),
      matchedOrder: processed ? { custName: best.CustName, prodName: best.DisplayName, orderDtm: best.OrderDtm } : null,
    });
    if (processed && e.sender && processedBy) {
      const k = `${e.sender}→${processedBy}`;
      matchedSenderToMgr.set(k, (matchedSenderToMgr.get(k) || 0) + 1);
    }
  }

  // ── 4) 집계
  const bySender = new Map(), byWeek = new Map(), byRoom = new Map(), byType = new Map();
  for (const e of filtered) {
    bump(bySender, e.sender, e.quantity);
    bump(byWeek, majorWeek(e.week) ? `${majorWeek(e.week)}차` : '미상', e.quantity);
    bump(byRoom, e.room, e.quantity);
    bump(byType, e.eventType || '기타', e.quantity);
  }

  // ── 5) 네트워크: 발신자→처리담당자 엣지 + 같은 thread 공동참여(발신자↔발신자)
  const threadMembers = new Map();
  for (const e of filtered) {
    if (!e.threadId || !e.sender) continue;
    if (!threadMembers.has(e.threadId)) threadMembers.set(e.threadId, new Set());
    threadMembers.get(e.threadId).add(e.sender);
  }
  const coEdges = new Map();
  for (const set of threadMembers.values()) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const k = [arr[i], arr[j]].sort().join('↔');
      coEdges.set(k, (coEdges.get(k) || 0) + 1);
    }
  }
  const network = {
    flow: [...matchedSenderToMgr.entries()].map(([k, v]) => { const [from, to] = k.split('→'); return { from, to, count: v }; }),
    cowork: [...coEdges.entries()].map(([k, v]) => { const [a, b] = k.split('↔'); return { a, b, count: v }; }).sort((x, y) => y.count - x.count).slice(0, 40),
  };

  const processedCnt = tracking.filter(t => t.processed).length;

  return res.status(200).json({
    success: true,
    kakaoAvailable, kakaoError,
    filters: { week: qWeek, room: qRoom },
    totals: {
      events: filtered.length,
      requests: tracking.length,
      processed: processedCnt,
      unprocessed: tracking.length - processedCnt,
      senders: bySender.size,
      orders: orders.length,
    },
    bySender: sortedVals(bySender),
    byWeek: [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byRoom: sortedVals(byRoom),
    byType: sortedVals(byType),
    tracking: tracking.sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 300),
    network,
    decisions: decisions.slice(0, 200),
    weeksInPlay,
  });
}

export default withAuth(handler);
