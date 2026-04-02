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
  const EP = 'AccountBasic/SaveBasicCust';
  const base = { CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: '01', USE_YN: 'Y' };
  const results = {};

  // 최상위 제어 필드 시도
  results['SAVE_MODE_I'] = await call(EP, sid, { SAVE_MODE: 'I', CustomerList: [base] });
  results['SAVE_MODE_U'] = await call(EP, sid, { SAVE_MODE: 'U', CustomerList: [base] });
  results['SAVE_MODE_S'] = await call(EP, sid, { SAVE_MODE: 'S', CustomerList: [base] });
  results['GBN_I'] = await call(EP, sid, { GBN: 'I', CustomerList: [base] });
  results['ACTION_SAVE'] = await call(EP, sid, { ACTION: 'SAVE', CustomerList: [base] });
  results['TYPE_1'] = await call(EP, sid, { TYPE: '1', CustomerList: [base] });

  return res.status(200).json({ success: true, results });
});
