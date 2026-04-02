// pages/api/ecount/probe.js  — 사용 후 삭제
import { withAuth } from '../../../lib/auth';
import { getSession, isConfigured } from '../../../lib/ecount';

const ZONE = process.env.ECOUNT_ZONE || 'cc';
const API_BASE = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

async function call(endpoint, sessionId, body) {
  const url = `${API_BASE}/${endpoint}?SESSION_ID=${sessionId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sessionId = await getSession();

  // 1) status=undefined 케이스 전체 응답 확인
  const r1 = await call('AccountBasic/SaveBasicCust', sessionId, {});
  const r2 = await call('AccountBasic/SaveBasicCust', sessionId, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }]
  });
  const r3 = await call('AccountBasic/SaveBasicCust', sessionId, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01', USE_YN: 'Y' }]
  });
  // InventoryBasic/GetBasicProductsList 정상 응답 전체 구조 확인 (비교용)
  const r4 = await call('InventoryBasic/GetBasicProductsList', sessionId, {});

  return res.status(200).json({
    SaveBasicCust_empty: r1,
    SaveBasicCust_CustomerList: r2,
    SaveBasicCust_CustomerList_UseYn: r3,
    GetBasicProductsList_ref: {
      Status: r4?.Status,
      DataKeys: r4?.Data ? Object.keys(r4.Data) : null,
      DataSample: r4?.Data
        ? JSON.stringify(r4.Data).slice(0, 300)
        : null,
      Error: r4?.Error,
    },
  });
});
