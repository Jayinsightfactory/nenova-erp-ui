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
      Errors: (d.Errors||[]).map(e => ({ Code: e.Code, Msg: e.Message })),
      sc: d.Data?.SuccessCnt, fc: d.Data?.FailCnt,
      ResultDetails: d.Data?.ResultDetails,
    };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0,100) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const EP = 'AccountBasic/SaveBasicCust';
  const results = {};

  // 1) BulkDatas 빈 배열 포함
  results['with_BulkDatas'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: '01', USE_YN: 'Y', BulkDatas: [] }]
  });

  // 2) ContactList 포함
  results['with_ContactList'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: '01', USE_YN: 'Y', ContactList: [] }]
  });

  // 3) 아무것도 없는 Customer (빈 CustomerList)
  results['empty_list'] = await call(EP, sid, {
    CustomerList: []
  });

  // 4) 기존 이카운트 거래처 CUST_CD 정확히 조회하기 (재고 엔드포인트로)
  results['Inventory_Stock'] = await call('Inventory/GetInvtByLocProd', sid, {
    Conditions: { WH_CD: '100' }
  });

  return res.status(200).json({ success: true, results });
});
