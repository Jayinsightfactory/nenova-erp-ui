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
    const errs = (d.Errors||[]).map(e=>e.Message);
    const dataPreview = d.Data
      ? (Array.isArray(d.Data) ? `Array[${d.Data.length}] first=${JSON.stringify(d.Data[0]||{}).slice(0,100)}`
         : JSON.stringify(d.Data).slice(0,200))
      : null;
    return { Status: d.Status, Errors: errs, dataPreview };
  } catch(e) {
    return { httpStatus: r.status, raw: text.slice(0,100) };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) return res.status(503).json({ error: '미설정' });
  const sid = await getSession();
  const results = {};

  // 판매 관련 GET 엔드포인트로 이카운트 기존 데이터 확인
  results['Sale_GetSaleList'] = await call('Sale/GetSaleList', sid, {
    Conditions: { IO_DATE_FROM: '20260301', IO_DATE_TO: '20260331' }
  });

  results['Sale_GetSale'] = await call('Sale/GetSale', sid, {
    Conditions: { IO_DATE_FROM: '20260301', IO_DATE_TO: '20260331' }
  });

  results['Inventory_GetInventoryList'] = await call('Inventory/GetInventoryList', sid, {
    Conditions: {}
  });

  // 거래처 등록: CUST_CD 없이 auto (AUTO_CUST_CD 시도)
  results['SaveCust_autoCD'] = await call('AccountBasic/SaveBasicCust', sid, {
    CustomerList: [{ CUST_NM: '네트워크테스트', CUST_TYPE: '01', USE_YN: 'Y', AUTO_CUST_CD: 'Y' }]
  });

  // 거래처 등록: CUST_CD 숫자형
  results['SaveCust_numCD'] = await call('AccountBasic/SaveBasicCust', sid, {
    CustomerList: [{ CUST_CD: '9999999999', CUST_NM: '테스트거래처', CUST_TYPE: '01', USE_YN: 'Y' }]
  });

  return res.status(200).json({ success: true, results });
});
