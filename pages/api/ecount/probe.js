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

  const ep = 'AccountBasic/SaveBasicCust';
  const cust = { CUST_CD: 'TEST001', CUST_NM: '테스트거래처', CUST_TYPE: '01', USE_YN: 'Y' };

  // "JSON 데이터 형식이 잘못 되었습니다" = 키 이름이 틀림
  // 올바른 body 키 이름 탐색
  const bodyVariants = {
    // 이카운트 OAPI SaveBasicCust 가능한 키 이름들
    'CustList':           { CustList:           [cust] },
    'Cust':               { Cust:               [cust] },
    'CustBasicList':      { CustBasicList:       [cust] },
    'BasicCust':          { BasicCust:           [cust] },
    'BasicCustList':      { BasicCustList:       [cust] },
    'CUST_LIST':          { CUST_LIST:           [cust] },
    'CustRegList':        { CustRegList:         [cust] },
    'CustSaveList':       { CustSaveList:        [cust] },
    'SaveCustList':       { SaveCustList:        [cust] },
    'InputCustList':      { InputCustList:       [cust] },
    'InCustList':         { InCustList:          [cust] },
    'REQUEST':            { REQUEST:             [cust] },
    'Request':            { Request:             [cust] },
    'Data':               { Data:               { CustList: [cust] } },
    'DataCustList':       { Data:               [cust] },
    'CustMasterList':     { CustMasterList:      [cust] },
    'AccountList':        { AccountList:         [cust] },
    'BasicAccountList':   { BasicAccountList:    [cust] },
    'TradingList':        { TradingList:         [cust] },
    'PartnerList':        { PartnerList:         [cust] },
    'VendorList':         { VendorList:          [cust] },
    'CustomerList':       { CustomerList:        [cust] },  // 현재 코드
    'single_Cust_obj':    { Cust:                cust   },  // 배열 아닌 단일 객체
    'single_CustList_obj':{ CustList:            cust   },  // 배열 아닌 단일 객체
  };

  const results = {};
  for (const [label, body] of Object.entries(bodyVariants)) {
    const d = await call(ep, sessionId, body);
    const msgs = (d?.Errors || []).map(e => e.Message).join(' | ');
    const sc = d?.Data?.SuccessCnt;
    const fc = d?.Data?.FailCnt;
    // JSON 형식 오류 없으면 유망한 키
    const tag = msgs.includes('JSON 데이터 형식') ? 'JSON_ERR'
              : msgs.includes('데이터 입력에 오류') ? `DATA_ERR(sc=${sc},fc=${fc})`
              : msgs ? `OTHER: ${msgs.slice(0,80)}`
              : `OK? sc=${sc} fc=${fc}`;
    results[label] = tag;
  }

  return res.status(200).json({ success: true, results });
});
