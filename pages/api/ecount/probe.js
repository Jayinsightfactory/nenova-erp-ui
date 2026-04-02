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
    const d = JSON.parse(text);
    return {
      Status: d.Status,
      Errors: (d.Errors||[]).map(e => e.Message),
      Error:  d.Error?.Message,
      sc: d.Data?.SuccessCnt,
      fc: d.Data?.FailCnt,
    };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0, 200) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const EP = 'AccountBasic/SaveBasicCust';
  const results = {};

  // 1) 빈 아이템
  results['empty_item'] = await call(EP, sid, {
    CustomerList: [{}]
  });

  // 2) CUST_NAME (NM 대신)
  results['CUST_NAME'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NAME: '테스트', USE_YN: 'Y' }]
  });

  // 3) 거래처 유형 없이
  results['no_type'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', USE_YN: 'Y' }]
  });

  // 4) AccountList 키
  results['AccountList'] = await call(EP, sid, {
    AccountList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', USE_YN: 'Y' }]
  });

  // 5) 기존 거래처 CD로 (이카운트에 실제 존재하는 것)
  results['real_cd_no_type'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: '0000000001', CUST_NM: '(주)내노바', USE_YN: 'Y' }]
  });

  return res.status(200).json({ success: true, ep: EP, results });
});
