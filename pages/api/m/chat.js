// pages/api/m/chat.js — 모바일 챗봇 메인 라우터
import { withAuth } from '../../../lib/auth';
import { routeIntent } from '../../../lib/chat/router';
import { appendTurn, clearHistory } from '../../../lib/chat/memory';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { message, payload, reset } = req.body || {};

  // 홈 버튼 같이 대화 초기화 요청
  if (reset === true) {
    clearHistory(req.user);
    return res.status(200).json({ success: true, reset: true });
  }

  const text = (message || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, error: '메시지가 비어있습니다.' });
  }
  try {
    const result = await routeIntent(text, req.user, payload || null);

    // 대화 기록에 보관 (선택지/객관식 응답은 제외 — 본격 답변만)
    const botText = (result?.messages || [])
      .filter(m => m.type === 'text')
      .map(m => m.content || '')
      .join('\n');
    if (botText) {
      appendTurn(req.user, { userMessage: text, botText, payload: payload || null });
    }

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[chat]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
