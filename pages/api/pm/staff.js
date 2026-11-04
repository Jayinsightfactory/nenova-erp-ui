// pages/api/pm/staff.js
// /pm 직원 상세 서랍 — 서버에 이미 있는 runtime 파일(workflows·simulations·proposals·storyboards)에서 한 사람 요약만 돌려준다.
// 게이트: /api/pm/office 와 동일(verifyReqUser + isOrbitReportViewer, 아니면 404). 읽기 전용·파일 전용, MSSQL 무관.
// storyboards(16MB)는 mtime 캐시로 한 번만 파싱하고 사람별 요약(events·sessions·boards 수)만 보관한다.
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath } from '../../../lib/workFeatureData';
import { buildStaffSlice, findPerson } from '../../../lib/pmStaff';
import { timesavePerson } from '../../../lib/pmTimesave';

const _cache = {};
function readCached(name, map) {
  const f = featureFilePath(name);
  try {
    const key = f + '|' + fs.statSync(f).mtimeMs;
    if (_cache[name]?.key !== key) { const raw = JSON.parse(fs.readFileSync(f, 'utf8')); _cache[name] = { key, data: map ? map(raw) : raw }; }
    return _cache[name].data;
  } catch { return null; }
}
const storySummaries = (raw) => ({
  people: (raw?.people || []).map((p) => ({ name: p.name, events: p.events ?? null, sessions: Array.isArray(p.sessions) ? p.sessions.length : (p.sessions ?? null), boards: Array.isArray(p.boards) ? p.boards.length : 0 })),
});

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  const name = String(req.query.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ success: false, error: 'name 필요' });
  res.setHeader('Cache-Control', 'private, no-store');
  const story = readCached('storyboards', storySummaries);
  const slice = buildStaffSlice(name, {
    workflows: readCached('workflows'), simulations: readCached('simulations'), proposals: readCached('proposals'),
    storySummary: findPerson(story?.people, name),
  });
  slice.timesave = timesavePerson(readCached('timesave'), name);
  if (slice.timesave) slice.hasData = true;
  return res.status(200).json({ success: true, data: slice });
}
