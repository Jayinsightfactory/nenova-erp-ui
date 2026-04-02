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
      Errors: (d.Errors||[]).map(e=>e.Message),
      sc: d.Data?.SuccessCnt,
      fc: d.Data?.FailCnt,
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

  // 1) 정수형 CUST_TYPE
  results['intType_1'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: 1, USE_YN: 'Y' }]
  });

  // 2) TAX_TYPE 추가
  results['with_TAX'] = await call(EP, sid, {
    CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트', CUST_TYPE: '01', USE_YN: 'Y', TAX_TYPE: 'Y' }]
  });

  // 3) 모든 가능한 필드 포함
  results['full_fields'] = await call(EP, sid, {
    CustomerList: [{
      CUST_CD: 'TEST001',
      CUST_NM: '테스트거래처',
      CUST_TYPE: '01',
      USE_YN: 'Y',
      TAX_TYPE: 'Y',
      TAX_NO: '',
      BOSS_NM: '',
      TEL_NO: '',
      FAX_NO: '',
      EMAIL: '',
      ADDR1: '',
      ADDR2: '',
      SELL_PRICE: 0,
      BUY_PRICE: 0,
    }]
  });

  // 4) CUST_TYPE 없이 다른 필드만
  results['no_type_full'] = await call(EP, sid, {
    CustomerList: [{
      CUST_CD: 'TEST001',
      CUST_NM: '테스트거래처',
      USE_YN: 'Y',
      TAX_TYPE: 'Y',
    }]
  });

  return res.status(200).json({ success: true, results });
});
