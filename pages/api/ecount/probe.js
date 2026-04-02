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

  // AccountBasic/SaveBasicCust 가 정답 endpoint.
  // body 키 이름 탐색: "JSON 데이터 형식" → 키 틀림 / "데이터 입력에 오류" → 키 맞음
  const EP = 'AccountBasic/SaveBasicCust';
  const cust = { CUST_CD: 'PROBE001', CUST_NM: '프로브테스트', CUST_TYPE: '01', USE_YN: 'Y' };

  const keyVariants = [
    'CustomerList', 'CustList', 'Cust', 'CustBasicList', 'BasicCustList',
    'BasicCust', 'CUST_LIST', 'CustRegList', 'CustSaveList', 'SaveCustList',
    'InputCustList', 'InCustList', 'Request', 'CustMasterList',
    'AccountList', 'BasicAccountList', 'TradingList', 'PartnerList',
    'VendorList', 'LIST', 'DataList', 'SaveList',
  ];

  async function testKey(key, value) {
    try {
      const url = `${API_BASE}/${EP}?SESSION_ID=${sessionId}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch(e) { return `HTML_RESP(${r.status}): ${text.slice(0,50)}`; }
      const msgs = (d?.Errors || []).map(e => e.Message).join(' | ');
      const errMsg = d?.Error?.Message || msgs || '';
      const sc = d?.Data?.SuccessCnt;
      const fc = d?.Data?.FailCnt;
      if (errMsg.includes('JSON 데이터 형식')) return 'JSON_ERR';
      if (errMsg.includes('데이터 입력에 오류') || errMsg.includes('data error')) return `DATA_ERR sc=${sc} fc=${fc}`;
      if (d?.Status === 200 && !errMsg) return `OK sc=${sc} fc=${fc}`;
      return `OTHER(${d?.Status}): ${errMsg.slice(0, 100)}`;
    } catch(e) {
      return `FETCH_ERR: ${e.message.slice(0, 80)}`;
    }
  }

  const results = {};

  // 배열 키 테스트
  for (const key of keyVariants) {
    results[`arr:${key}`] = await testKey(key, [cust]);
  }
  // 단일 객체 키 테스트
  for (const key of ['CustomerList', 'CustList', 'Cust', 'Request']) {
    results[`obj:${key}`] = await testKey(key, cust);
  }

  // 목록 조회 endpoint 도 탐색
  const listEps = [
    'AccountBasic/GetBasicCustList', 'AccountBasic/GetCustList',
    'AccountBasic/GetCustomerList',  'BasInfo/GetCustomerList',
  ];
  for (const ep of listEps) {
    try {
      const url = `${API_BASE}/${ep}?SESSION_ID=${sessionId}`;
      const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
      const d = await r.json();
      results[`GET:${ep}`] = `status=${d.Status} msg="${(d.Error?.Message||'').slice(0,80)}"`;
    } catch(e) { results[`GET:${ep}`] = e.message; }
  }

  return res.status(200).json({ success: true, zone: ZONE, ep: EP, results });
});
