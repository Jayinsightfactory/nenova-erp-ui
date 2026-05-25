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
    await logChatAudit({
      user: req.user,
      userMessage: text,
      payload: payload || null,
      clientHistory: normalizedClientHistory,
      result: null,
      error: err,
      durationMs: Date.now() - startedAt,
    });
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
