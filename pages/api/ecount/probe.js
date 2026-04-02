// pages/api/ecount/probe.js — 임시 진단 API
import { withAuth } from '../../../lib/auth';
import { getSession, isConfigured } from '../../../lib/ecount';

const ZONE = (process.env.ECOUNT_ZONE || 'cc').toUpperCase();
const BASE = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

async function call(ep, sessionId, body) {
  const r = await fetch(`${BASE}/${ep}?SESSION_ID=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);   // raw 응답 전체 반환
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0, 300) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const EP = 'AccountBasic/SaveBasicCust';
  const results = {};

  // 1) 최소 필드 (CUST_NM만)
  results['minimal'] = await call(EP, sid, {
    CustomerList: [{ CUST_NM: '테스트거래처', USE_YN: 'Y' }]
  });

  // 2) CUST_CD 포함 (새 코드)
  results['with_code'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', USE_YN: 'Y' }]
  });

  // 3) BulkDatas 래퍼 테스트
  results['bulk_wrap'] = await call(EP, sid, {
    BulkDatas: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', USE_YN: 'Y' }]
  });

  // 4) 기존 이카운트 CUST_CD로 업데이트
  results['update_existing'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: '0000000001', CUST_NM: '(주)내노바', USE_YN: 'Y' }]
  });

  return res.status(200).json({ success: true, results });
});
