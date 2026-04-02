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
      qty: d.Data?.QUANTITY_INFO,
    };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0, 150) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const EP = 'AccountBasic/SaveBasicCust';
  const results = {};

  // 먼저 Sale/SaveSale 성공 호출로 연속오류 카운터 리셋 시도
  results['sale_reset'] = await call('Sale/SaveSale', sid, {
    SaleList: [{
      IO_DATE: '20260402', CUST_CD: '0000000001',
      WH_CD: '100', IO_TYPE: '1', CURRENCY: 'KRW', AR_NO: '자동',
      BulkDatas: [{ PROD_CD: '0000000001', QTY: 1, SUPPLY_AMT: 1000, VAT_AMT: 100 }]
    }]
  });

  // CUST_TYPE 알파벳 변형 (S=매출, P=매입, B=매출매입)
  for (const tp of ['S','P','B','A','1','2']) {
    results[`type_${tp}`] = await call(EP, sid, {
      CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: tp, USE_YN: 'Y' }]
    });
  }

  // CUST_CD 없이 (omit, not empty string)
  const { CUST_CD: _, ...noCode } = { CUST_CD: '', CUST_NM: '테스트', CUST_TYPE: 'S', USE_YN: 'Y' };
  results['no_cust_cd'] = await call(EP, sid, {
    CustomerList: [{ CUST_NM: '테스트', CUST_TYPE: '01', USE_YN: 'Y' }]
  });

  return res.status(200).json({ success: true, results });
});
