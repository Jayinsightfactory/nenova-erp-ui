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
      sc: d.Data?.SuccessCnt,
      fc: d.Data?.FailCnt,
    };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0,120) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const results = {};

  // BasInfo 계열 SaveCust 시도
  results['BasInfo_SaveCust'] = await call('BasInfo/SaveCust', sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', USE_YN: 'Y' }]
  });
  results['BasInfo_SaveCustomer'] = await call('BasInfo/SaveCustomer', sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', USE_YN: 'Y' }]
  });
  results['BasInfo_SaveCustInfo'] = await call('BasInfo/SaveCustInfo', sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', USE_YN: 'Y' }]
  });

  // 이카운트에 실제 등록된 품목 확인 (BasInfo/GetProdList)
  results['BasInfo_GetProdList'] = await call('BasInfo/GetProdList', sid, {
    Conditions: {}
  });

  return res.status(200).json({ success: true, results });
});
