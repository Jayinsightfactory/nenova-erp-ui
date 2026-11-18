// 수입 도착 공지 방(스케줄방·빌번호방·네노바&선율방) 원문을 Orbit 읽기 통로에서 받아 온다. 서버 전용·읽기 전용.
// 통로 규칙(기간 최대 7일, afterKey 페이지, 방 고정)은 Orbit routes/kakao-decrypt.js nenova-import-schedule-feed 와 같다.
import { IMPORT_SCHEDULE_ROOMS } from './importFlightNotice.js';

const ENDPOINT = 'https://mindmap-viewer-production-adb2.up.railway.app/api/kakao/nenova-import-schedule-feed';
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MS = 60000;
let cached = null;
let pending = null;

function validCursor(value) {
  return typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

// 한국 시간 오프셋이 붙은 ISO 문자열(통로가 오프셋 있는 ISO 만 받는다).
export function isoKst(ms) {
  const d = new Date(ms + 9 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`;
}

// 조회 기간을 7일 이하 창으로 나눈다(최근 것부터).
export function feedWindows(nowMs, days) {
  const out = [];
  let end = nowMs + 60000;
  const start = nowMs - days * 24 * 60 * 60 * 1000;
  while (end > start) {
    const from = Math.max(start, end - WINDOW_MS);
    out.push({ from: isoKst(from), to: isoKst(end) });
    end = from;
  }
  return out;
}

async function readRoomWindow(fetchImpl, token, room, win, signal) {
  const messages = [];
  const seen = new Set();
  let afterKey = '';
  for (let page = 0; page < 20; page++) {
    const url = new URL(ENDPOINT);
    Object.entries({ room, from: win.from, to: win.to, afterKey, limit: '200' }).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal, redirect: 'error' });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = await response.json();
    if (data.ok !== true || !Array.isArray(data.messages) || data.messages.length > 200 || typeof data.hasMore !== 'boolean'
      || (data.nextAfterKey !== null && !validCursor(data.nextAfterKey)) || (data.hasMore && !data.nextAfterKey)) throw new Error('contract');
    if (data.messages.some(row => row.chatroom !== room || typeof row.message !== 'string' || !row.external_message_id)) throw new Error('scope');
    messages.push(...data.messages);
    if (!data.hasMore) return messages;
    if (data.nextAfterKey === afterKey || seen.has(data.nextAfterKey)) throw new Error('cursor');
    seen.add(data.nextAfterKey);
    afterKey = data.nextAfterKey;
  }
  throw new Error('incomplete');
}

// 반환: { messages, rooms: { [방]: { count, error } }, fetchedAt }. 방 하나가 실패해도 나머지는 돌려준다.
export async function readImportScheduleFeed(token, { days = 14, now = Date.now(), fetchImpl = fetch, fresh = false } = {}) {
  // 「새로고침」을 누르면 보관분(1분)을 쓰지 않고 다시 읽는다. 단 5초 안의 연타는 묶는다.
  if (cached && fresh && cached.token === token && cached.days === days && Date.now() - cached.at < 5000) return cached.value;
  if (!fresh && cached && cached.token === token && cached.days === days && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (pending && pending.token === token && pending.days === days) return pending.promise;
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const rooms = {};
    const messages = [];
    const seenIds = new Set();
    try {
      const windows = feedWindows(now, days);
      await Promise.all(IMPORT_SCHEDULE_ROOMS.map(async room => {
        rooms[room] = { count: 0, error: null, latestMessageAt: null, latestImportedAt: null };
        try {
          for (const win of windows) {
            const rows = await readRoomWindow(fetchImpl, token, room, win, controller.signal);
            for (const row of rows) {
              const id = `${row.chat_id}|${row.external_message_id}`;
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              messages.push({ chatroom: row.chatroom, sender: row.sender, message: row.message, created_at: row.created_at, external_message_id: row.external_message_id, timestamp_approximate: row.timestamp_approximate, imported_at: row.imported_at });
              rooms[room].count++;
              for (const [field, value] of [['latestMessageAt', row.created_at], ['latestImportedAt', row.imported_at]]) {
                if (Number.isFinite(Date.parse(value)) && (!rooms[room][field] || Date.parse(value) > Date.parse(rooms[room][field]))) rooms[room][field] = value;
              }
            }
          }
        } catch (error) {
          rooms[room].error = String(error?.message || 'error').slice(0, 40);
        }
      }));
    } finally {
      clearTimeout(timer);
    }
    const value = { messages, rooms, fetchedAt: new Date().toISOString() };
    if (Object.values(rooms).some(r => !r.error)) cached = { token, days, at: Date.now(), value };
    return value;
  })();
  pending = { token, days, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}
