// pages/api/pm/grow.js — /pm 키우기 미니게임 상태(직원 단계·진행률·오늘 원인·부서 정원). 게이트는 /api/pm/office 와 동일. 읽기 전용.
// 계산은 피드 수신 시 서버(lib/pmGrowStore)에서만 한다. 급여·평가 무관.
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { readGrowState } from '../../../lib/pmGrowStore';
import fs from 'fs';
import path from 'path';
import { growView, kstDay } from '../../../lib/pmGrow';
import { vibesView, water } from '../../../lib/pmMood';
import { canActFor } from '../../../lib/pmAccount';

// 일일 물주기(출석) 기록 — 포인트 무관, 시듦 회복·연속일 표시만. data/runtime/pm-care.json
const careFile = () => path.join(process.cwd(), 'data', 'runtime', 'pm-care.json');
const readCare = () => { try { return JSON.parse(fs.readFileSync(careFile(), 'utf8')) || {}; } catch { return {}; } };

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  res.setHeader('Cache-Control', 'private, no-store');
  const now = Date.now();
  if (req.method === 'POST' && req.body?.action === 'water') {
    // 본인 화분만(관리자는 대리). 하루 1번.
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name || !canActFor(user, name)) return res.status(403).json({ success: false, error: '본인 화분만 물 줄 수 있습니다' });
    const r = water(readCare(), name, kstDay(now), new Date(now).toISOString());
    if (!r.already) { const f = careFile(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(r.care)); fs.renameSync(`${f}.${process.pid}.tmp`, f); }
    return res.status(200).json({ success: true, already: r.already, care: r.entry });
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'GET only' }); }
  const state = readGrowState();
  const care = readCare();
  if (state?.people) for (const [n, c] of Object.entries(care)) if (state.people[n] && c.caredAt) state.people[n].caredAt = c.caredAt;
  return res.status(200).json({ success: true, data: { ...growView(state, now), vibes: vibesView(state, now, kstDay), care } });
}
