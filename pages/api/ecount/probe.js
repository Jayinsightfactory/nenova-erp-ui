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
  const c = { CUST_CD: 'PR001', CUST_NM: '프로브', CUST_TYPE: '01', USE_YN: 'Y' };

  // 가장 유망한 키 이름 7개만 테스트
  const keys = ['CustomerList','CustList','Cust','BasicCustList','AccountList','TradingList','PartnerList'];
  const results = {};
  for (const k of keys) {
    results[k] = await call(EP, sid, { [k]: [c] });
  }

  return res.status(200).json({ success: true, ep: EP, results });
});
