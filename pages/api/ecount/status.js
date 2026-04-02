// pages/api/ecount/status.js
// GET: 이카운트 API 연결 상태 확인 (실제 API ping 포함)
// withAuth 인증 필수

import { withAuth } from '../../../lib/auth';
import { getSession, getSessionInfo, isConfigured } from '../../../lib/ecount';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  if (!isConfigured()) {
    return res.status(200).json({
      success:   true,
      connected: false,
      zone:      process.env.ECOUNT_ZONE?.toUpperCase() || 'CC',
      comCode:   null,
      message:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요. (ECOUNT_COM_CODE, ECOUNT_USER_ID)',
    });
  }

  try {
    // 실제 세션 확인 (세션 없으면 로그인 시도)
    await getSession();
    const info = getSessionInfo();

    return res.status(200).json({
      success:       true,
      connected:     true,
      zone:          info.zone,
      comCode:       info.comCode,
      userId:        info.userId,
      sessionExpiry: info.expiresAt,
      message:       '이카운트 API 연결 정상',
    });
  } catch (err) {
    return res.status(200).json({
      success:   true,
      connected: false,
      zone:      process.env.ECOUNT_ZONE?.toUpperCase() || 'CC',
      comCode:   process.env.ECOUNT_COM_CODE || null,
      message:   `연결 실패: ${err.message}`,
    });
  }
});
