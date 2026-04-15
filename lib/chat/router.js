// lib/chat/router.js — 자연어 메시지를 인텐트로 분류하고 핸들러 호출
// Phase 2: 룰 기반 키워드 매칭
// Phase 5: LLM fallback 추가 예정

import { handleOrderLookup } from './handlers/order';
import { handleStockLookup } from './handlers/stock';
import { handleShipmentLookup } from './handlers/shipment';
import { handleSalesLookup } from './handlers/sales';
import { handleReceivableLookup } from './handlers/receivable';
import { handleOrderRequestFlow } from './handlers/orderRequest';
import { handleHelp } from './handlers/help';
import { inferIntentWithLLM } from './llm';
import { handleSqlAgent } from './sqlagent';
import { getHistory } from './memory';

// ── 유틸: 차수 추출 "15-02", "15차", "15-1" 등  (기존 시그니처 유지 — 문자열 반환)
export function extractWeek(text) {
  const m = text.match(/(\d{1,2})\s*(?:-|차\s*)(\d{1,2})?/);
  if (m) {
    const y = m[1].padStart(2, '0');
    const n = (m[2] || '01').padStart(2, '0');
    return `${y}-${n}`;
  }
  const mm = text.match(/(\d{1,2})\s*차/);
  if (mm) return `${mm[1].padStart(2, '0')}-01`;
  return null;
}

// ── 차수 상세 추출 (세부차수 명시 여부까지 판별)
// "15-02"        → { major:'15', minor:'02', week:'15-02', exact:true }
// "15차 02" / "15차2" → 동일
// "15차"         → { major:'15', minor:null,  week:null,    exact:false }
// 못 찾음        → null
export function extractWeekDetail(text) {
  const m1 = text.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (m1) {
    const major = m1[1].padStart(2, '0');
    const minor = m1[2].padStart(2, '0');
    return { major, minor, week: `${major}-${minor}`, exact: true };
  }
  const m2 = text.match(/(\d{1,2})\s*차\s*(\d{1,2})/);
  if (m2) {
    const major = m2[1].padStart(2, '0');
    const minor = m2[2].padStart(2, '0');
    return { major, minor, week: `${major}-${minor}`, exact: true };
  }
  const m3 = text.match(/(\d{1,2})\s*차/);
  if (m3) {
    return { major: m3[1].padStart(2, '0'), minor: null, week: null, exact: false };
  }
  return null;
}

// ── 유틸: 기간 키워드
export function extractPeriod(text) {
  if (/오늘/.test(text)) return 'today';
  if (/어제/.test(text)) return 'yesterday';
  if (/이번\s*주/.test(text)) return 'thisWeek';
  if (/이번\s*달|이달/.test(text)) return 'thisMonth';
  if (/지난\s*달/.test(text)) return 'lastMonth';
  if (/작년/.test(text)) return 'lastYear';
  return null;
}

// ── 복잡 질의 감지 — 집계/순위/기간+카운트 등은 SQL 에이전트 전용
// 고정 인텐트 핸들러로는 제대로 답할 수 없는 패턴들.
export function isComplexQuery(text) {
  return (
    /\b(top|TOP)\s*\d+/i.test(text) ||
    /상위\s*\d+|하위\s*\d+/.test(text) ||
    /\d+\s*(곳|개|건|품목|명)\s*(?:을|를)?/.test(text) ||
    /(몇|얼마)\s*(?:단|송이|박스|BOX|BUNCH|원|건|곳|개|품목|%|명)/i.test(text) ||
    /(최다|최소|최대|최저|최고|평균|중앙값|순위|랭킹|합계)/.test(text) ||
    /(그룹\s*별|별로|분석|비율|퍼센트|증감|대비)/.test(text) ||
    /(YoY|MoM|전년\s*대비|전월\s*대비)/i.test(text) ||
    // "량" 으로 끝나는 집계어 (출고량/판매량/매출량/주문량/입고량/재고량)
    /(출고량|출고\s*수량|판매량|판매\s*수량|매출량|주문량|입고량|재고량)/.test(text) ||
    // 기간 지정 집계 (출고/매출/판매 + 이번 달/지난 달/작년/올해/이번 주)
    /(이번\s*달|지난\s*달|이번\s*주|지난\s*주|작년|올해|금년|전년)/.test(text) && /(출고|입고|매출|판매|주문|재고|거래|합)/.test(text) ||
    // "최근 N 차/주/일/월" — SQL agent 로 집계
    /최근\s*\d+\s*(차|주|일|월|건)/.test(text) ||
    // "어땠어/어땠나/어떻게/얼마나" 등 자연스러운 자유질의 표지
    /(어땠|어떤지|어떻게|얼마나|몇\s*번)/.test(text)
  );
}

// ── 인텐트 분류 (우선순위 순)
function classify(text) {
  const t = text.toLowerCase();

  // 승인 대기, 신청 목록
  if (/승인\s*대기|신청\s*목록|신청\s*내역/.test(text)) {
    return { intent: 'order_request_pending' };
  }
  // 주문 등록 신청
  if (/(주문|발주)\s*(등록)?\s*(신청|요청|만들|추가)/.test(text)) {
    return { intent: 'order_request_new' };
  }
  // 도움말
  if (/도움|헬프|help|메뉴|뭐\s*할/i.test(text)) {
    return { intent: 'help' };
  }
  // 재고
  if (/재고|부족|남은\s*수량|잔량/.test(text)) {
    return { intent: 'stock' };
  }
  // 미수금 / 매출
  if (/미수금|미수|채권|수금/.test(text)) {
    return { intent: 'receivable' };
  }
  if (/매출|수익|영업\s*실적|TOP|탑\s*\d/.test(text)) {
    return { intent: 'sales' };
  }
  // 출고
  if (/출고|확정|미확정|배송/.test(text)) {
    return { intent: 'shipment' };
  }
  // 주문 조회
  if (/주문|발주|오더/.test(text)) {
    return { intent: 'order' };
  }
  return { intent: 'unknown' };
}

// ── 메인 라우터
// payload: 선택지 버튼에서 전달되는 structured intent
//   { intent: 'order', week: '16-01', custKey: 5, mode: 'byItem'|'total', ... }
export async function routeIntent(text, user, payload = null) {
  const history = getHistory(user);

  // 복잡 질의 (집계/순위/카운트) 는 고정 핸들러 건너뛰고 SQL 에이전트 직행
  if (!payload && isComplexQuery(text)) {
    const agent = await handleSqlAgent(text, { history });
    if (agent) return agent;
    // 에이전트도 실패하면 기존 흐름 계속
  }

  let intent = payload?.intent || classify(text).intent;
  let llmPayload = null;

  // 룰 분류 실패 → LLM fallback (API 키 있을 때만)
  if (!payload && intent === 'unknown') {
    const inferred = await inferIntentWithLLM(text);
    if (inferred && inferred.intent && inferred.intent !== 'unknown') {
      intent = inferred.intent;
      // LLM 이 뽑은 구조화 필드를 payload 로 승격 — 핸들러가 바로 활용
      llmPayload = {
        intent,
        ...(inferred.week     ? { week:     inferred.week }     : {}),
        ...(inferred.major    ? { major:    inferred.major }    : {}),
        ...(inferred.country  ? { country:  inferred.country }  : {}),
        ...(inferred.flower   ? { flower:   inferred.flower }   : {}),
        ...(inferred.period   ? { period:   inferred.period }   : {}),
        ...(inferred.mode     ? { mode:     inferred.mode }     : {}),
        ...(inferred.scope    ? { scope:    inferred.scope }    : {}),
        _fromLLM: true,
      };
    }
  }
  const effectivePayload = payload || llmPayload;

  switch (intent) {
    case 'help':                   return await handleHelp(text, user, effectivePayload);
    case 'order':                  return await handleOrderLookup(text, user, effectivePayload);
    case 'stock':                  return await handleStockLookup(text, user, effectivePayload);
    case 'shipment':               return await handleShipmentLookup(text, user, effectivePayload);
    case 'sales':                  return await handleSalesLookup(text, user, effectivePayload);
    case 'receivable':             return await handleReceivableLookup(text, user, effectivePayload);
    case 'order_request_new':      return await handleOrderRequestFlow(text, user, 'new');
    case 'order_request_pending':  return await handleOrderRequestFlow(text, user, 'pending');
    default: {
      // 최종 fallback: Text-to-SQL 에이전트
      const agentResult = await handleSqlAgent(text, { history });
      if (agentResult) return agentResult;
      return {
        messages: [
          { type: 'text', content: '질문을 이해하지 못했습니다 🤔\n아래 예시처럼 물어보세요:' },
          {
            type: 'actions',
            actions: [
              { label: '도움말', text: '도움말' },
              { label: '오늘 출고', text: '오늘 출고 확정 업체' },
              { label: '이번 달 매출', text: '이번 달 매출' },
              { label: '재고 부족', text: '재고 부족 품목' },
            ],
          },
        ],
      };
    }
  }
}
