// pages/api/work/manuals.js
// 직원 업무 매뉴얼 API — 웹 전용 JSON 파일만 읽고 씀(MSSQL 무관).
// GET  → 내가 볼 수 있는 매뉴얼 + 부서표 + 내 배치
// POST { action:'save', id, steps, summary, confirm } | { action:'layout', key, order }
import { withAuth } from '../../../lib/auth';
import { DEPARTMENTS, isManualAdmin, visibleManuals, getLayout, saveManualEdit, saveLayout } from '../../../lib/workManuals';

export default withAuth(async function handler(req, res) {
  const user = req.user;
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      isAdmin: isManualAdmin(user),
      me: user.userName || user.userId,
      departments: DEPARTMENTS,
      manuals: visibleManuals(user),
      layout: getLayout(user),
    });
  }
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'save') {
      const r = saveManualEdit(user, String(body.id || ''), body);
      return r.ok ? res.status(200).json({ success: true, manual: r.manual }) : res.status(r.status).json({ success: false, error: r.error });
    }
    if (body.action === 'layout') {
      return saveLayout(user, body.key, body.order)
        ? res.status(200).json({ success: true })
        : res.status(400).json({ success: false, error: '잘못된 배치 요청' });
    }
    return res.status(400).json({ success: false, error: '알 수 없는 action' });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
