// pages/api/ecount/probe.js
// 이카운트 OAPI V2 endpoint 경로 존재 여부 탐색용 임시 API
// 사용 후 삭제 필요

import { withAuth } from '../../../lib/auth';
import { getSession, isConfigured } from '../../../lib/ecount';

const ZONE = process.env.ECOUNT_ZONE || 'cc';
const API_BASE = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

async function probeEndpoint(endpoint, sessionId) {
  const url = `${API_BASE}/${endpoint}?SESSION_ID=${sessionId}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    const msg = data?.Error?.Message || data?.Errors?.[0]?.Message || '';
    const status = data?.Status;

    if (msg === 'Not Found') return 'MISSING';
    if (msg && msg.includes('No HTTP resource')) return 'NO_METHOD';
    if (msg === 'Please login.') return 'LOGIN_REQUIRED'; // SESSION_ID가 있는데 이 오류? 비정상
    // Status 200이거나 다른 오류 = 경로 존재
    return `EXISTS (status=${status}, msg=${msg.slice(0, 80)})`;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: '이카운트 설정 미완료' });
  }

  const sessionId = await getSession();

  // 테스트할 후보 endpoint 목록
  const candidates = [
    // 알려진 정상 경로 (기준선)
    'InventoryBasic/GetBasicProductsList',
    'Sale/SaveSale',
    'Purchases/SavePurchases',

    // 거래처 조회 후보
    'AccountBasic/SaveBasicCust',          // 이미 EXISTS 확인됨
    'AccountBasic/GetBasicCustList',
    'AccountBasic/GetBasicCustListAll',
    'AccountBasic/GetBasicCustByCondition',
    'AccountBasic/GetBasicCustListByCondition',
    'AccountBasic/GetListBasicCust',
    'AccountBasic/GetListBasicCustByCondition',
    'AccountBasic/GetCustList',
    'AccountBasic/GetBasicCust',
    'AccountBasic/SearchBasicCust',
    'AccountBasic/GetBasicCustMasterList',

    // 다른 카테고리 시도
    'BasInfo/GetCustomerList',             // 현재 코드 (실패 중)
    'BasInfo/SaveCustomer',               // 현재 코드 (실패 중)
  ];

  const results = {};
  for (const ep of candidates) {
    results[ep] = await probeEndpoint(ep, sessionId);
  }

  return res.status(200).json({ success: true, sessionId: sessionId.slice(0, 8) + '...', results });
});
