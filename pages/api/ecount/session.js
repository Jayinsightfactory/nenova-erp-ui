// pages/api/ecount/session.js
// GET:  세션 상태 조회
// POST: 세션 강제 새로고침
// withAuth 인증 필수

import { withAuth } from '../../../lib/auth';
import { getSession, refreshSession, getSessionInfo, isConfigured } from '../../../lib/ecount';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    // 현재 세션 상태 반환 (로그인 시도 없음)
    const info = getSessionInfo();
    return res.status(200).json({
      success:   true,
      isReady:   info.isReady,
      comCode:   info.comCode,
      userId:    info.userId,
      zone:      info.zone,
      expiresAt: info.expiresAt,
      configured: isConfigured(),
      message:   info.isReady
        ? `세션 유효 (만료: ${info.expiresAt ? new Date(info.expiresAt).toLocaleTimeString('ko-KR') : '-'})`
        : isConfigured() ? '세션 없음 (다음 API 호출 시 자동 로그인)' : '이카운트 환경변수 미설정',
    });
  }

  if (req.method === 'POST') {
    // 강제 세션 새로고침
    if (!isConfigured()) {
      return res.status(503).json({
        success: false,
        error:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요. (ECOUNT_COM_CODE, ECOUNT_USER_ID)',
      });
    }

    try {
      const sessionId = await refreshSession();
      const info      = getSessionInfo();
      return res.status(200).json({
        success:   true,
        isReady:   true,
        comCode:   info.comCode,
        userId:    info.userId,
        zone:      info.zone,
        expiresAt: info.expiresAt,
        message:   `세션 갱신 완료 (만료: ${new Date(info.expiresAt).toLocaleTimeString('ko-KR')})`,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
});
