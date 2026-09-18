// pages/api/work/replay.js
// nenovaweb 화면 기록(rrweb) API — 웹 전용 파일만 읽고 씀(MSSQL 무관, ERP 원장 side effect 없음).
// GET  ?me=1                    → { record } 이 계정이 기록 대상인지(녹화기 로딩 여부)
// GET  ?list=1                  → 세션 목록 (nenovaSS3 만)
// GET  ?user=<id>&session=<id>  → 세션 이벤트 (nenovaSS3 만)
// POST { sessionId, events }    → 이벤트 추가 (기록 대상 계정 본인 것만)
import { withAuth } from '../../../lib/auth';
import { canRecord, canViewReplay, appendEvents, listSessions, readSession } from '../../../lib/workReplay';

export const config = { api: { bodyParser: { sizeLimit: '4mb' }, responseLimit: false } };

export default withAuth(async function handler(req, res) {
  const user = req.user;
  if (req.method === 'GET') {
    if (req.query.me) return res.status(200).json({ success: true, record: canRecord(user) });
    if (!canViewReplay(user)) return res.status(404).json({ success: false, error: 'Not found' });
    if (req.query.list) return res.status(200).json({ success: true, sessions: listSessions() });
    const s = readSession(String(req.query.user || ''), String(req.query.session || ''));
    return s ? res.status(200).json({ success: true, ...s }) : res.status(404).json({ success: false, error: '세션 없음' });
  }
  if (req.method === 'POST') {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } } // sendBeacon(text/plain)
    const r = appendEvents(user, body.sessionId, body.events);
    return r.ok ? res.status(200).json({ success: true, full: !!r.full }) : res.status(r.status).json({ success: false, error: r.error });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
