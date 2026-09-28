// pages/api/work/orbit-thumbs.js
// /my-work '업무 흐름' 탭의 '실제 캡처 화면' — Orbit 화면 해독 썸네일을 같은 출처로 중계(읽기 전용, MSSQL 무관).
// 권한: nenovaSS3 전용(pages/my-work.js getServerSideProps 와 같은 isOrbitReportViewer 게이트, 그 외 404 은닉).
// GET ?user=<uid>&hours=&limit= → { items:[{id,timestamp,app,activity,screen,hint}] }
// GET ?img=<eventId>            → image/jpeg 프록시(같은 출처라 canvas drawImage 가 tainted 되지 않음)
// Orbit 인증: env ORBIT_OWNER_TOKEN 이 있으면 Bearer 로 붙임(없으면 무헤더).
import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';

export const config = { api: { responseLimit: false } };

const ORBIT = () => (process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app').replace(/\/+$/, '');
const ID_RE = /^[\w.:-]+$/;
const clampInt = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
const orbitHeaders = () => (process.env.ORBIT_OWNER_TOKEN ? { Authorization: `Bearer ${process.env.ORBIT_OWNER_TOKEN}` } : {});

export function normalizeThumb(t) {
  if (!t || typeof t !== 'object') return null;
  const id = String(t.id ?? t.eventId ?? '');
  if (!ID_RE.test(id)) return null;
  const s = (v) => (v == null ? '' : String(v));
  return { id, timestamp: s(t.timestamp ?? t.ts), app: s(t.app), activity: s(t.activity), screen: s(t.screen), hint: s(t.hint) };
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  if (!isOrbitReportViewer(req.user)) return res.status(404).json({ success: false, error: 'Not found' });

  if (req.query.img != null) {
    const id = String(req.query.img);
    if (!ID_RE.test(id)) return res.status(400).json({ success: false, error: 'img id 형식 오류' });
    try {
      const r = await fetch(`${ORBIT()}/api/vision/thumbnail/${encodeURIComponent(id)}`, { headers: orbitHeaders() });
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ success: false, error: `Orbit ${r.status}` });
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).send(buf);
    } catch (e) { return res.status(502).json({ success: false, error: 'Orbit 연결 실패: ' + e.message }); }
  }

  const user = String(req.query.user || '').trim();
  if (!user || !ID_RE.test(user)) return res.status(400).json({ success: false, error: 'user 필요' });
  const hours = clampInt(req.query.hours, 72, 1, 24 * 30);
  const limit = clampInt(req.query.limit, 60, 1, 300);
  try {
    const q = new URLSearchParams({ userId: user, hours: String(hours), limit: String(limit) });
    const r = await fetch(`${ORBIT()}/api/vision/thumbnails?${q}`, { headers: orbitHeaders() });
    if (!r.ok) return res.status(502).json({ success: false, error: `Orbit ${r.status}`, items: [] });
    const j = await r.json();
    const raw = Array.isArray(j) ? j : (j.items || j.thumbnails || j.rows || []);
    const items = raw.map(normalizeThumb).filter(Boolean).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return res.status(200).json({ success: true, user, hours, items, captured: j.captured ?? j.total ?? null });
  } catch (e) { return res.status(502).json({ success: false, error: 'Orbit 연결 실패: ' + e.message, items: [] }); }
});
