// pages/api/automation/[resource].js
// n8n(및 기타 자동화) 전용 read-only 브리지 API.
//   - 토큰(헤더) 인증: Authorization: Bearer <AUTOMATION_API_TOKEN>  또는  x-automation-token: <...>
//   - GET 전용, 읽기 전용. ERP 원본/ECOUNT에 쓰기 없음.
//   - 토큰은 서버 환경변수 AUTOMATION_API_TOKEN 에만 둔다(코드/로그 노출 금지).
//
// 리소스:
//   GET /api/automation/ping                    → 헬스체크
//   GET /api/automation/sales-revenue-summary    → 영업매출관리 비교 요약(저장 Batch/시드 기반)
//       ?channel=양재동 (선택)
//
// ⚠️ 토큰은 URL 쿼리로 받지 않는다(URL 로깅 노출 방지). 반드시 헤더로 전달.

import { buildSummary } from '../../../lib/salesRevenueBatches';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';

function getToken(req) {
  const auth = req.headers.authorization || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  return bearer || (req.headers['x-automation-token'] || '').toString().trim();
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'GET only' });
  }

  const expected = process.env.AUTOMATION_API_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, error: 'AUTOMATION_API_TOKEN 미설정(서버 .env.local). GitHub Secret 동기화 필요.' });
  }
  if (getToken(req) !== expected) {
    return res.status(401).json({ success: false, error: '인증 토큰이 올바르지 않습니다.' });
  }

  const { resource, channel = null } = req.query;

  if (resource === 'ping') {
    return res.status(200).json({ success: true, app: 'nenovaweb', resource: 'ping', time: new Date().toISOString() });
  }

  if (resource === 'sales-revenue-summary') {
    const mappings = loadSalesRevenueMappings();
    const s = buildSummary({ channel, mappings });
    return res.status(200).json({
      success: true,
      resource,
      channel: s.channel,
      weeks: s.weeks,
      totals: s.totals,
      customerCount: s.customers.length,
      customers: s.customers,
    });
  }

  return res.status(404).json({ success: false, error: `알 수 없는 리소스: ${resource}` });
}
