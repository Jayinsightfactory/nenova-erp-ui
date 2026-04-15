// pages/api/m/diag.js — 챗봇 진단 (인증된 내부 사용자 전용)
// SQL 에이전트 / LLM fallback 이 호출되는지 환경·설정 체크용.
// 키 값은 노출하지 않고 존재 여부만 반환.
import { withAuth } from '../../../lib/auth';
import { isComplexQuery } from '../../../lib/chat/router';

async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const testQ = req.query.q || '16차에 주문 가장 많이 한 거래처 상위 3곳';
  return res.status(200).json({
    success: true,
    anthropicKeyPresent: !!apiKey,
    anthropicKeyLength: apiKey ? apiKey.length : 0,
    anthropicKeyPrefix: apiKey ? apiKey.slice(0, 10) + '...' : null,
    nodeEnv: process.env.NODE_ENV,
    railwayEnv: process.env.RAILWAY_ENVIRONMENT || null,
    sampleQuestion: testQ,
    isComplex: isComplexQuery(testQ),
  });
}

export default withAuth(handler);
