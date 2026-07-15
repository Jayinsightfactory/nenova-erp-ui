// pages/api/automation/[resource].js
// n8n(및 기타 자동화) 전용 read-only 브리지 API.
//   - 토큰(헤더) 인증: Authorization: Bearer <AUTOMATION_API_TOKEN>  또는  x-automation-token: <...>
//   - GET 전용, 읽기 전용. ERP 원본/ECOUNT에 쓰기 없음.
//   - 토큰은 서버 환경변수 AUTOMATION_API_TOKEN 에만 둔다(코드/로그 노출 금지).
//
// 리소스:
//   GET /api/automation/ping                     → 헬스체크
//   GET /api/automation/sales-revenue-summary     → 영업매출관리 비교 요약(저장 Batch/시드 기반)  ?channel=양재동
//   GET /api/automation/proxy?path=<허용경로>&...  → 기존 검증된 read GET API 안전 프록시
//        허용 path: /api/sales/status, /api/sales/ar, /api/shipment/stock-status,
//                   /api/stats/sales, /api/stats/dashboard
//        예) /api/automation/proxy?path=/api/sales/ar&type=list
//            /api/automation/proxy?path=/api/shipment/stock-status&week=24-01
//
// 프록시는 내부에서 짧은(2분) 서비스 JWT를 발급해 localhost 의 기존 엔드포인트를 GET 으로만 호출한다.
// allowlist 에 없는 경로/메서드는 거부 → n8n 은 read 전용 범위에 갇힌다(write/push 불가).

import jwt from 'jsonwebtoken';
import { buildSummary } from '../../../lib/salesRevenueBatches';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { getJwtSecret } from '../../../lib/auth';

// 프록시 허용 경로(전부 read GET). 여기 없는 경로는 호출 불가.
const PROXY_ALLOW = new Set([
  '/api/sales/status',
  '/api/sales/ar',
  '/api/shipment/stock-status',
  '/api/stats/sales',
  '/api/stats/dashboard',
]);

function getToken(req) {
  const auth = req.headers.authorization || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  return bearer || (req.headers['x-automation-token'] || '').toString().trim();
}

async function handleProxy(req, res) {
  const target = (req.query.path || '').toString();
  if (!PROXY_ALLOW.has(target)) {
    return res.status(400).json({ success: false, error: '허용되지 않은 path', allow: [...PROXY_ALLOW] });
  }
  // path/resource/token 외 쿼리는 그대로 전달
  const fwd = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'resource' || k === 'path' || k === 'token') continue;
    fwd.append(k, Array.isArray(v) ? v[0] : v);
  }
  const port = process.env.PORT || 3000;
  const qs = fwd.toString();
  const url = `http://127.0.0.1:${port}${target}${qs ? `?${qs}` : ''}`;
  let jwtSecret;
  try {
    jwtSecret = getJwtSecret();
  } catch (e) {
    return res.status(503).json({ success: false, error: 'JWT_SECRET 서버 미설정' });
  }
  const svcJwt = jwt.sign(
    { userId: 'n8n-bridge', userName: 'n8n-bridge', authority: 'read', deptName: 'automation' },
    jwtSecret,
    { expiresIn: '2m' }
  );
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${svcJwt}` } });
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ success: false, error: '프록시 호출 실패: ' + e.message });
  }
}

export default async function handler(req, res) {
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
      salesByYear: s.salesByYear,
      salesTotal: s.salesTotal,
      customerCount: s.customers.length,
      customers: s.customers,
    });
  }

  if (resource === 'proxy') {
    return handleProxy(req, res);
  }

  return res.status(404).json({ success: false, error: `알 수 없는 리소스: ${resource}` });
}
