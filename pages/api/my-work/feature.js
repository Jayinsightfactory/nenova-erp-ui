// pages/api/my-work/feature.js
// /my-work 탭 데이터 지연 로딩 — 탭을 열 때만 해당 파일을 받는다(SSR props 에 전부 싣던 것 대체).
// 게이트는 pages/my-work.js 와 동일: verifyReqUser + isOrbitReportViewer(아니면 404 은닉).
// 경로는 lib/workFeatureData.featureFilePath(data/runtime 최신본 우선). 읽기 전용.
//   GET ?name=proposals|workflows|simulations      → 파일 전체
//   GET ?name=storyboards&who=&b=&s=               → 선택한 직원·제안·세션 장면만(+ 직원 목차)
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath, FEATURE_NAMES } from '../../../lib/workFeatureData';

// 파일별 파싱 캐시(경로·수정 시각이 바뀌면 다시 읽음)
const _cache = {};
function readFeature(name) {
  const f = featureFilePath(name);
  try {
    const key = f + '|' + fs.statSync(f).mtimeMs;
    if (_cache[name]?.key !== key) _cache[name] = { key, data: JSON.parse(fs.readFileSync(f, 'utf8')) };
    return _cache[name].data;
  } catch { return null; }
}

function sliceStoryboards(full, q) {
  if (!full?.people?.length) return null;
  const who = full.people.find((p) => p.name === q.who) || full.people[0];
  const bi = Math.min(Math.max(parseInt(q.b, 10) || 0, 0), Math.max(who.boards.length - 1, 0));
  const si = Math.min(Math.max(parseInt(q.s, 10) || 0, 0), Math.max((who.boards[bi]?.sessions.length || 1) - 1, 0));
  return {
    generatedAt: full.generatedAt, note: full.note,
    people: full.people.map((p) => ({ name: p.name, events: p.events, sessions: p.sessions })),
    who: who.name, bi, si,
    boardList: who.boards.map((b) => ({ title: b.title, matchedSessions: b.matchedSessions })),
    board: who.boards[bi] ? { ...who.boards[bi], sessions: who.boards[bi].sessions.map(({ steps, narrative, ...meta }) => meta) } : null,
    session: who.boards[bi]?.sessions[si] || null,
  };
}

export default function handler(req, res) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) return res.status(404).json({ success: false, error: 'Not found' });
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const name = String(req.query.name || '');
  if (!FEATURE_NAMES.includes(name)) return res.status(400).json({ success: false, error: 'name 은 ' + FEATURE_NAMES.join('|') });
  res.setHeader('Cache-Control', 'private, no-store');
  const full = readFeature(name);
  const data = name === 'storyboards' ? sliceStoryboards(full, req.query) : full;
  return res.status(200).json({ success: true, name, data });
}
