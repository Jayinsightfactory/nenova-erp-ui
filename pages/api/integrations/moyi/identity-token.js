import { withAuth } from '../../../../lib/auth';
import { createMoyiIdentityExchangeToken } from '../../../../lib/moyiIdentityBridge';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST만 허용됩니다.' });
  try {
    const exchangeToken = createMoyiIdentityExchangeToken(req.user);
    return res.status(200).json({
      success: true,
      exchange_token: exchangeToken,
      token_type: 'Bearer',
      expires_in: 120,
    });
  } catch (error) {
    console.error('[moyi identity token]', error.message);
    return res.status(503).json({ success: false, error: 'MOYI 사용자 연결 설정을 확인하세요.' });
  }
}

export default withAuth(handler);
