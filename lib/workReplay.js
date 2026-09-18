// lib/workReplay.js
// nenovaweb 화면 기록(rrweb) 저장소 — 웹 전용 파일만 읽고 씀(MSSQL 무관).
// 기록 대상은 명시 화이트리스트(시범: nenovaSS3 본인만). 열람은 nenovaSS3 만.
// 저장: data/replay/<userId>/<sessionId>.jsonl (이벤트 1줄 1건) + <sessionId>.meta.json (목록·단계 요약)
// 상한: 세션 8MB · 사용자 300MB · 14일 — 넘으면 오래된 세션부터 지운다(서버 디스크 보호).
import fs from 'fs';
import path from 'path';
import { isOrbitReportViewer } from './orbitReportAccess';

export const RECORD_USER_IDS = Object.freeze(['nenovaSS3']); // 직원 적용은 고지·입력값 마스킹 결정 후 여기에 추가
const RECORD_SET = new Set(RECORD_USER_IDS.map((x) => x.toLowerCase()));
const SESSION_MAX = 8 * 1024 * 1024, USER_MAX = 300 * 1024 * 1024, KEEP_DAYS = 14, STEP_MAX = 800;
const ID_RE = /^[a-z0-9-]{8,40}$/;

const root = () => path.join(process.cwd(), 'data', 'replay');
const uidOf = (user) => String(user?.userId ?? user?.UserID ?? '').trim();
const safeUid = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

export function canRecord(user) { return RECORD_SET.has(uidOf(user).toLowerCase()); }
export function canViewReplay(user) { return isOrbitReportViewer(user); }

function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }

function prune(dir) {
  let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return; }
  const rows = files.map((f) => { const st = fs.statSync(path.join(dir, f)); return { f, size: st.size, m: st.mtimeMs }; }).sort((a, b) => a.m - b.m);
  let total = rows.reduce((a, r) => a + r.size, 0);
  const old = Date.now() - KEEP_DAYS * 86400e3;
  for (const r of rows) {
    if (r.m >= old && total <= USER_MAX) break;
    try { fs.unlinkSync(path.join(dir, r.f)); fs.unlinkSync(path.join(dir, r.f.replace(/\.jsonl$/, '.meta.json'))); } catch {}
    total -= r.size;
  }
}

// rrweb 커스텀 이벤트(type 5, data.tag = nv-click|nv-input|nv-route)를 단계 목록으로 요약
function stepOf(ev) {
  if (!ev || ev.type !== 5 || !ev.data || typeof ev.data.tag !== 'string' || !ev.data.tag.startsWith('nv-')) return null;
  const p = ev.data.payload || {};
  const cut = (v, n) => String(v ?? '').slice(0, n);
  return { t: ev.timestamp, kind: ev.data.tag.slice(3), path: cut(p.path, 120), label: cut(p.label, 80), value: cut(p.value, 120), tag: cut(p.tag, 20) };
}

export function appendEvents(user, sessionId, events) {
  if (!canRecord(user)) return { ok: false, status: 403, error: '기록 대상 계정이 아닙니다' };
  if (!ID_RE.test(String(sessionId || ''))) return { ok: false, status: 400, error: '잘못된 sessionId' };
  if (!Array.isArray(events) || !events.length) return { ok: false, status: 400, error: 'events 없음' };
  const dir = path.join(root(), safeUid(uidOf(user)));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`), metaFile = path.join(dir, `${sessionId}.meta.json`);
  const isNew = !fs.existsSync(file);
  if (isNew) prune(dir);
  const size = isNew ? 0 : fs.statSync(file).size;
  if (size > SESSION_MAX) return { ok: true, full: true }; // 상한 도달 — 조용히 버림(클라이언트는 새 세션을 연다)
  const clean = events.filter((e) => e && typeof e.type === 'number' && typeof e.timestamp === 'number');
  if (!clean.length) return { ok: false, status: 400, error: '유효한 이벤트 없음' };
  fs.appendFileSync(file, clean.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const meta = readJson(metaFile, { sessionId, userId: uidOf(user), userName: user.userName || '', from: clean[0].timestamp, to: clean[0].timestamp, events: 0, routes: [], steps: [] });
  meta.events += clean.length;
  meta.to = Math.max(meta.to, clean[clean.length - 1].timestamp);
  for (const e of clean) {
    const s = stepOf(e); if (!s) continue;
    if (s.kind === 'route' && meta.routes[meta.routes.length - 1] !== s.path) meta.routes.push(s.path);
    if (meta.steps.length < STEP_MAX) meta.steps.push(s);
  }
  meta.routes = meta.routes.slice(-200);
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return { ok: true, full: size + 1 > SESSION_MAX };
}

export function listSessions() {
  const out = [];
  let users; try { users = fs.readdirSync(root()); } catch { return out; }
  for (const u of users) {
    let files; try { files = fs.readdirSync(path.join(root(), u)).filter((f) => f.endsWith('.meta.json')); } catch { continue; }
    for (const f of files) {
      const m = readJson(path.join(root(), u, f), null); if (!m) continue;
      let size = 0; try { size = fs.statSync(path.join(root(), u, f.replace(/\.meta\.json$/, '.jsonl'))).size; } catch {}
      out.push({ sessionId: m.sessionId, userId: m.userId, userName: m.userName, from: m.from, to: m.to, events: m.events, size, routes: m.routes, stepCount: m.steps.length });
    }
  }
  return out.sort((a, b) => b.from - a.from);
}

export function readSession(userId, sessionId) {
  if (!ID_RE.test(String(sessionId || ''))) return null;
  const dir = path.join(root(), safeUid(userId));
  const file = path.join(dir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { meta: readJson(path.join(dir, `${sessionId}.meta.json`), null), events };
}
