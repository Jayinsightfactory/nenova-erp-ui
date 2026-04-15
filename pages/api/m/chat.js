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

    // 대화 기록에 보관 — text + card 평탄화 (LLM 후속 질문 맥락 이해용)
    const parts = [];
    for (const m of (result?.messages || [])) {
      if (m.type === 'text' && m.content) {
        parts.push(m.content);
      } else if (m.type === 'card' && m.card) {
        const c = m.card;
        const rowsStr = (c.rows || []).slice(0, 20)
          .map(r => `${r.label}: ${r.value}`).join(', ');
        parts.push(`[${c.title || '카드'}${c.subtitle ? ` - ${c.subtitle}` : ''}] ${rowsStr}${c.footer ? ` (${c.footer})` : ''}`);
      } else if (m.type === 'cards' && m.cards) {
        for (const c of m.cards) {
          const rowsStr = (c.rows || []).slice(0, 10)
            .map(r => `${r.label}: ${r.value}`).join(', ');
          parts.push(`[${c.title || '카드'}] ${rowsStr}`);
        }
      }
    }
    const botText = parts.join('\n').slice(0, 2000);
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
