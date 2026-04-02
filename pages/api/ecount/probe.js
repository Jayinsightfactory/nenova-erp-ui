// pages/api/ecount/probe.js
// 이카운트 OAPI V2 AccountBasic/SaveBasicCust body 구조 탐색용 임시 API
// 사용 후 삭제 필요

import { withAuth } from '../../../lib/auth';
import { getSession, isConfigured } from '../../../lib/ecount';

const ZONE = process.env.ECOUNT_ZONE || 'cc';
const API_BASE = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

async function callEndpoint(endpoint, sessionId, body) {
  const url = `${API_BASE}/${endpoint}?SESSION_ID=${sessionId}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: '이카운트 설정 미완료' });
  }

  const sessionId = await getSession();

  // AccountBasic/SaveBasicCust 에 다양한 body 구조로 테스트
  const tests = {
    // 현재 코드 방식 (CustomerList 키)
    'CustomerList_key': {
      CustomerList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }]
    },
    // 단수형
    'Customer_key': {
      Customer: { CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }
    },
    // CustList 키
    'CustList_key': {
      CustList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }]
    },
    // Cust 키
    'Cust_key': {
      Cust: { CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }
    },
    // BasicCustList 키
    'BasicCustList_key': {
      BasicCustList: [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }]
    },
    // 빈 body
    'empty_body': {},
    // 직접 배열
    'array_body': [{ CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01' }],
    // 이카운트 실제 필드명 다양하게
    'with_more_fields': {
      CustomerList: [{
        CUST_CD: 'TEST001',
        CUST_NM: '테스트거래처',
        CUST_TYPE: '01',
        CUST_TYPE_NM: '매출처',
        USE_YN: 'Y',
        REGION: '',
        BSNS_NM: '',
        CEO_NM: '',
        BIZ_REG_NO: '',
        TEL_NO: '',
      }]
    },
  };

  const results = {};
  for (const [label, body] of Object.entries(tests)) {
    const data = await callEndpoint('AccountBasic/SaveBasicCust', sessionId, body);
    const status = data?.Status;
    const msg = data?.Error?.Message || data?.Errors?.[0]?.Message || '';
    results[label] = `status=${status} | ${msg.slice(0, 120)}`;
  }

  return res.status(200).json({ success: true, results });
});
