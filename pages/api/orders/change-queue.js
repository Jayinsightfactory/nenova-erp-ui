// pages/api/orders/change-queue.js
// 카톡 변경 큐 — 영업방 카톡 원문에서 "변경사항/검역차감/발주추가" 메시지를 자동 분류·파싱하고
// kakao-audit.js의 auditText()로 주문등록/출고분배 DB와 대조한 뒤, 사람이 [반영됨]/[무시]만 누르는 화면용 API.
// ⚠ GET=SELECT만, 전산 테이블 쓰기 없음. 주문/분배 반영은 사람이 exe·웹 화면에서 직접 하고
//    여기서는 그 처리 여부(반영됨/무시)를 웹 전용 파일(data/kakao-change-queue.json)에 표시만 한다.
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../lib/auth';
import { auditMessages, auditText } from './kakao-audit';

const SALES_FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const salesFeedCache = new Map();

function validAfterKey(value) {
  return typeof value === 'string' && value.length <= 512 && !/[--]/.test(value);
}

const STATE_FILE = path.join(process.cwd(), 'data', 'kakao-change-queue.json');

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// 분류 규칙: 정규식 + 확신도. change-queue 대상은 변경사항/검역차감/발주추가만.
const CATEGORY_RULES = [
  { category: '변경사항', re: /변경사항/, confidence: 0.95, queue: true },
  { category: '검역차감', re: /검역차감|차감/, confidence: 0.9, queue: true },
  { category: '발주추가', re: /발주\s*추가|선발주/, confidence: 0.9, queue: true },
  { category: '잔량', re: /잔량|재고/, confidence: 0.7, queue: false },
  { category: '현장', re: /출고사진|박스\s*수량|출발|배차|도착/, confidence: 0.8, queue: false },
];

function classify(message) {
  const text = String(message || '');
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return { category: rule.category, confidence: rule.confidence, queue: rule.queue };
  }
  return { category: '기타', confidence: 0.5, queue: false };
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

async function fetchSalesFeed(from, to, { fresh = false } = {}) {
  const token = process.env.NENOVA_SALES_READ_TOKEN;
  if (!token) {
    const err = new Error('영업방 자동 연결 설정이 아직 완료되지 않았습니다.');
    err.code = 'SALES_FEED_NOT_CONFIGURED';
    throw err;
  }
  const cacheKey = `${from}|${to}`;
  const now = Date.now();
  const cached = salesFeedCache.get(cacheKey);
  if (!fresh && cached && cached.expiresAt > now) {
    return cached.messages;
  }
  const messages = [];
  // 상류(nenova-sales-feed)는 ISO 경계 + 한 번에 최대 7일 → 7일 창으로 잘라 순회(sales-feed.js의 periodBounds와 같은 규칙)
  const windows = [];
  for (let s = new Date(`${from}T00:00:00+09:00`); s < new Date(`${to}T00:00:00+09:00`); ) {
    const e = new Date(Math.min(s.getTime() + 7 * 86400000, new Date(`${to}T00:00:00+09:00`).getTime() + 86400000));
    windows.push({ from: s.toISOString(), to: e.toISOString() }); s = e;
  }
  for (const w of windows) {
  let afterKey = '';
  for (let page = 0; page < 10; page++) {
    if (!validAfterKey(afterKey)) throw new Error('대화 조회 위치가 올바르지 않습니다.');
    const url = new URL('https://mindmap-viewer-production-adb2.up.railway.app/api/kakao/nenova-sales-feed');
    Object.entries({ from: w.from, to: w.to, afterKey, limit: '200' }).forEach(([k, v]) => url.searchParams.set(k, v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let data;
    try {
      const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, redirect: 'error' });
      if (!upstream.ok) throw new Error('영업방 원문 서버에 연결하지 못했습니다.');
      data = await upstream.json();
    } finally {
      clearTimeout(timer);
    }
    if (data.ok !== true || !Array.isArray(data.messages) || data.messages.length > 200 || typeof data.hasMore !== 'boolean'
      || (data.nextAfterKey !== null && !validAfterKey(data.nextAfterKey))
      || (data.hasMore && (!validAfterKey(data.nextAfterKey) || data.nextAfterKey === ''))) {
      throw new Error('영업방 원문 형식이 올바르지 않습니다.');
    }
    messages.push(...data.messages);
    if (!data.hasMore) break;
    afterKey = data.nextAfterKey;
  }
  }
  if (salesFeedCache.size > 24) {
    const oldestKey = salesFeedCache.keys().next().value;
    if (oldestKey !== undefined) salesFeedCache.delete(oldestKey);
  }
  salesFeedCache.set(cacheKey, { messages, expiresAt: Date.now() + SALES_FEED_CACHE_TTL_MS });
  return messages;
}

function dedupe(messages) {
  const seen = new Map();
  const out = [];
  for (const m of messages) {
    const day = String(m.created_at || '').slice(0, 10);
    const key = `${day}|${normalizeText(m.message)}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    out.push(m);
  }
  return out;
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const { from: defFrom, to: defTo } = defaultRange();
    const from = String(req.query.from || defFrom);
    const to = String(req.query.to || defTo);
    const year = String(req.query.year || new Date().getFullYear());
    const fresh = req.query.fresh === '1';

    let messages;
    try {
      messages = await fetchSalesFeed(from, to, { fresh });
    } catch (e) {
      if (e.code === 'SALES_FEED_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, code: 'SALES_FEED_NOT_CONFIGURED', error: e.message });
      }
      return res.status(502).json({ success: false, error: e.message });
    }

    messages = dedupe(messages);

    const state = loadState();
    const counts = {};
    const queued = [];
    for (const m of messages) {
      const { category, confidence, queue } = classify(m.message);
      counts[category] = (counts[category] || 0) + 1;
      if (queue) queued.push({ message: m, category, confidence });
    }

    let batchedItems = null;
    if (queued.length > 0) {
      try {
        batchedItems = await auditMessages(queued.map(q => q.message.message), year, { forceMasters: fresh });
      } catch {
        batchedItems = null;
      }
    }

    const rows = [];
    for (let idx = 0; idx < queued.length; idx++) {
      const { message: m, category, confidence } = queued[idx];
      let items = [];
      let parseOk = true;
      if (Array.isArray(batchedItems)) {
        items = batchedItems[idx] || [];
        if (!items.length) parseOk = false;
      } else {
        try {
          const audited = await auditText(m.message, year, { forceMasters: false });
          items = audited.rows;
          if (!items.length) parseOk = false;
        } catch {
          items = [];
          parseOk = false;
        }
      }

      const decision = state[m.external_message_id] || null;
      rows.push({
        id: m.external_message_id,
        at: m.created_at,
        sender: m.sender,
        room: m.chatroom,
        category,
        confidence,
        text: m.message,
        parseOk,
        items,
        needReview: items.filter(it => it.status === '확인필요').length,
        status: decision?.status || 'pending',
        decided: decision ? { by: decision.by, byName: decision.byName, at: decision.at, note: decision.note || '' } : null,
      });
    }

    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    return res.status(200).json({ success: true, from, to, year, counts, rows });
  }

  if (req.method === 'POST') {
    const { id, action, note } = req.body || {};
    if (!id || !['applied', 'ignored', 'reset'].includes(action)) {
      return res.status(400).json({ success: false, error: 'id와 action(applied|ignored|reset)이 필요합니다.' });
    }
    const state = loadState();
    if (action === 'reset') {
      delete state[id];
    } else {
      state[id] = {
        status: action,
        by: req.user?.userId || null,
        byName: req.user?.userName || null,
        at: new Date().toISOString(),
        note: note || '',
      };
    }
    saveState(state);
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
});
