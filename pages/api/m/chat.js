// pages/api/m/chat.js — 모바일 챗봇 메인 라우터
// Phase 2 에서 각 인텐트 핸들러 추가 예정
import { withAuth } from '../../../lib/auth';
import { routeIntent } from '../../../lib/chat/router';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { message, payload } = req.body || {};
  const text = (message || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, error: '메시지가 비어있습니다.' });
  }
  try {
    const result = await routeIntent(text, req.user, payload || null);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[chat]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
