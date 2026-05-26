// pages/api/m/chat.js - mobile chatbot main route
import { withAuth } from '../../../lib/auth';
import { routeIntent } from '../../../lib/chat/router';
import { appendTurn, clearHistory } from '../../../lib/chat/memory';
import { flattenMessages, logChatAudit } from '../../../lib/chat/audit';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { message, payload, reset, clientHistory } = req.body || {};

  if (reset === true) {
    clearHistory(req.user);
    return res.status(200).json({ success: true, reset: true });
  }

  const text = (message || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, error: '메시지가 비어있습니다.' });
  }

  const normalizedClientHistory = Array.isArray(clientHistory) ? clientHistory : [];
  const startedAt = Date.now();

  try {
    const result = await routeIntent(text, req.user, payload || null, {
      clientHistory: normalizedClientHistory,
    });

    const botText = flattenMessages(result?.messages || []);
    if (botText) {
      appendTurn(req.user, {
        userMessage: text,
        botText,
        payload: payload || null,
        messages: result?.messages || [],
      });
    }

    await logChatAudit({
      user: req.user,
      userMessage: text,
      payload: payload || null,
      clientHistory: normalizedClientHistory,
      result,
      durationMs: Date.now() - startedAt,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[chat]', err);
    const errorMessage = String(err?.message || '');
    const result = {
      messages: [
        {
          type: 'text',
          content: '질문을 처리하다가 내부 조회 기준이 맞지 않는 부분을 발견했습니다.\n제가 바로 단정해서 답하기보다는, 어떤 기준으로 다시 볼지 확인하고 이어가겠습니다.',
        },
        {
          type: 'actions',
          actions: [
            { label: '재고 기준', text: `${text} 재고 기준으로 다시 조회` },
            { label: '출고 기준', text: `${text} 출고 기준으로 다시 조회` },
            { label: '주문 기준', text: `${text} 주문 기준으로 다시 조회` },
            { label: '매출 기준', text: `${text} 매출 기준으로 다시 조회` },
          ],
        },
      ],
      _askback: true,
      _debug: { error: errorMessage.slice(0, 500) },
    };
    await logChatAudit({
      user: req.user,
      userMessage: text,
      payload: payload || null,
      clientHistory: normalizedClientHistory,
      result,
      error: err,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({ success: true, ...result });
  }
}

export default withAuth(handler);
