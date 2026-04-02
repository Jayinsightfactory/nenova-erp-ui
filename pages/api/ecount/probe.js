// pages/api/ecount/probe.js
// 이카운트 OAPI V2 endpoint 이름 탐색용 임시 진단 API
import { withAuth } from '../../../lib/auth';
import { getSession, isConfigured } from '../../../lib/ecount';

const ZONE = (process.env.ECOUNT_ZONE || 'cc').toUpperCase();
const API_BASE = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: '이카운트 설정 필요' });
  }

  const sessionId = await getSession();

  const testCust = [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01', USE_YN: 'Y' }];
  const endpoints = [
    // 목록 조회 계열
    { ep: 'AccountBasic/GetBasicCustList',   body: { Conditions: {} } },
    { ep: 'AccountBasic/GetCustList',        body: { Conditions: {} } },
    { ep: 'AccountBasic/GetCustomerList',    body: { Conditions: {} } },
    { ep: 'BasInfo/GetCustomerList',         body: { Conditions: {} } },
    { ep: 'Bas/GetCustomerList',             body: { Conditions: {} } },
    // 저장 계열 (CustomerList 키)
    { ep: 'AccountBasic/SaveBasicCust',      body: { CustomerList: testCust } },
    { ep: 'AccountBasic/SaveCust',           body: { CustomerList: testCust } },
    { ep: 'AccountBasic/SaveCustomer',       body: { CustomerList: testCust } },
    // 저장 계열 (CustList 키)
    { ep: 'AccountBasic/SaveBasicCust',      body: { CustList: testCust } },
  ];

  const results = {};

  for (const { ep, body } of endpoints) {
    try {
      const url = `${API_BASE}/${ep}?SESSION_ID=${sessionId}`;
      const r = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await r.json();
      results[ep] = {
        httpStatus: r.status,
        status:     data.Status,
        errCode:    data.Error?.Code || (data.Errors?.[0]?.Code),
        message:    data.Error?.Message || data.Message || data.Data?.Message || '',
        hasData:    !!data.Data,
      };
    } catch (e) {
      results[ep] = { error: e.message };
    }
  }

  return res.status(200).json({ success: true, zone: ZONE, results });
});
