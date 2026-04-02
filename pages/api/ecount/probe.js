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

  const endpoints = [
    { ep: 'BasInfo/GetCustomerList',  body: { Conditions: {} } },
    { ep: 'Customer/GetCustomerList', body: { Conditions: {} } },
    { ep: 'BasInfo/GetCustList',      body: { Conditions: {} } },
    { ep: 'Cust/GetCustList',         body: { Conditions: {} } },
    { ep: 'BasInfo/SaveCustomer',     body: { CustomerList: [] } },
    { ep: 'Customer/SaveCustomer',    body: { CustomerList: [] } },
    { ep: 'Cust/SaveCust',            body: { CustList: [] } },
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
