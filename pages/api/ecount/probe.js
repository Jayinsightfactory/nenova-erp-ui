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
    if (msg === 'Please login.' || msg === '로그인 하기 바랍니다.') return 'SESSION_INVALID';
    // Status 200이거나 다른 오류 = 경로 존재!
    return `EXISTS: status=${status} | ${msg.slice(0, 100)}`;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: '이카운트 설정 미완료' });
  }

  const sessionId = await getSession();

  // 이카운트 OAPI V2 거래처 관련 모든 후보 endpoint
  const candidates = [
    // ── 기준선: 알려진 정상 경로 ──────────────────────────────
    'InventoryBasic/GetBasicProductsList',
    'Sale/SaveSale',
    'Purchases/SavePurchases',
    'InventoryBalance/GetListInventoryBalanceStatusByLocation',

    // ── 이미 발견된 거래처 저장 경로 ─────────────────────────
    'AccountBasic/SaveBasicCust',

    // ── 거래처 조회 후보 (AccountBasic 계열) ──────────────────
    'AccountBasic/GetBasicCustList',
    'AccountBasic/GetBasicCust',
    'AccountBasic/GetCustList',
    'AccountBasic/GetCust',
    'AccountBasic/GetListBasicCust',
    'AccountBasic/SearchBasicCust',
    'AccountBasic/GetBasicCustMasterList',
    'AccountBasic/GetAllBasicCust',
    'AccountBasic/GetBasicCustAll',
    'AccountBasic/GetBasicCustByCondition',
    'AccountBasic/GetBasicCustListByCondition',
    'AccountBasic/GetBasicCustListByPage',
    'AccountBasic/GetBasicCustCount',
    'AccountBasic/DeleteBasicCust',

    // ── 이카운트 공식 홈페이지에서 언급된 기능 기반 ───────────
    // "거래처등록, 품목등록, 품목조회, 재고현황" 공개됨
    // 거래처 "조회"는 공개 여부 불명확

    // ── InventoryBasic 계열 (품목 조회 패턴 분석) ────────────
    'InventoryBasic/GetBasicProductsList',
    'InventoryBasic/SaveBasicProducts',
    'InventoryBasic/SaveBasicProductsList',
    'InventoryBasic/GetBasicProductsListByCondition',
    'InventoryBasic/DeleteBasicProducts',

    // ── AccountBasic 계열 추가 탐색 ──────────────────────────
    'AccountBasic/SaveBasicVendor',
    'AccountBasic/GetBasicVendorList',
    'AccountBasic/SaveBasicCustomer',
    'AccountBasic/GetBasicCustomerList',
    'AccountBasic/SaveBasicAccount',
    'AccountBasic/GetBasicAccountList',
    'AccountBasic/SaveBasicTrading',
    'AccountBasic/GetBasicTradingList',

    // ── 현재 코드 (실패 중) ───────────────────────────────────
    'BasInfo/GetCustomerList',
    'BasInfo/SaveCustomer',
  ];

  const results = {};
  for (const ep of candidates) {
    results[ep] = await probeEndpoint(ep, sessionId);
  }

  // EXISTS 결과만 별도 정리
  const found = Object.entries(results)
    .filter(([, v]) => v.startsWith('EXISTS'))
    .map(([k, v]) => `${k} → ${v}`);

  return res.status(200).json({
    success: true,
    sessionOk: true,
    found,
    all: results,
  });
});
