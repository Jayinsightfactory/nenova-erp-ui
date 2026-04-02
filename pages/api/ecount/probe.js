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
    const msgs = [...(d?.Errors||[]).map(e=>e.Message), d?.Error?.Message, d?.Message].filter(Boolean).join(' | ');
    return { status: d.Status, msg: msgs.slice(0,120), sc: d?.Data?.SuccessCnt, fc: d?.Data?.FailCnt };
  } catch(e) {
    return { status: r.status, msg: 'HTML: ' + text.slice(0,80) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const EP = 'AccountBasic/SaveBasicCust';
  const results = {};

  // 1) 실제 이카운트 CUST_CD '0000000001'로 업데이트 테스트
  results['real_CUST_CD'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: '0000000001', CUST_NM: '(주)내노바', CUST_TYPE: '01', USE_YN: 'Y' }]
  });

  // 2) CUST_TYPE 값 변형 테스트
  for (const tp of ['01','02','03','E0','E1']) {
    results[`type_${tp}`] = await call(EP, sid, {
      CustomerList: [{ CUST_CD: '0000000001', CUST_NM: '(주)내노바', CUST_TYPE: tp, USE_YN: 'Y' }]
    });
  }

  // 3) BasInfo/GetCustomerList - 빈 body로 재시도
  results['GET_empty'] = await call('BasInfo/GetCustomerList', sid, {});
  results['GET_noConditions'] = await call('BasInfo/GetCustomerList', sid, { CUST_CD: '0000000001' });

  return res.status(200).json({ success: true, ep: EP, results });
});
