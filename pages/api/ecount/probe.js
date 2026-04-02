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
      Error: d.Error?.Message,
      sc: d.Data?.SuccessCnt,
      fc: d.Data?.FailCnt,
      dataKeys: d.Data ? Object.keys(d.Data).join(',') : null,
      // 거래처 목록이면 첫 3개만
      sample: Array.isArray(d.Data) ? d.Data.slice(0,3) :
              Array.isArray(d.Data?.Items) ? d.Data.Items.slice(0,3) : null,
    };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0, 150) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const results = {};

  // GET 엔드포인트 탐색
  results['GetBasicCustList'] = await call('AccountBasic/GetBasicCustList', sid, {
    Conditions: {}
  });

  results['GetBasicCustList2'] = await call('AccountBasic/GetBasicCustList', sid, {});

  results['GetBasicCustList3'] = await call('AccountBasic/GetBasicCustList', sid, {
    CUST_CD: '', USE_YN: 'Y'
  });

  // BasInfo 변형들
  results['BasInfo_GetCust'] = await call('BasInfo/GetCust', sid, { Conditions: {} });
  results['BasInfo_GetCustList'] = await call('BasInfo/GetCustList', sid, { Conditions: {} });

  return res.status(200).json({ success: true, results });
});
