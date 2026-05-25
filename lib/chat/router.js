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
import { buildInvestigativeClarification } from './clarifySearch';

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

function labelForIntent(intent) {
  switch (intent) {
    case 'order': return '주문 조회';
    case 'stock': return '재고 조회';
    case 'shipment': return '출고/확정 조회';
    case 'sales': return '매출 조회';
    case 'receivable': return '미수금 조회';
    default: return '업무 조회';
  }
}

function buildLLMIntentClarification(text, intent) {
  const label = labelForIntent(intent);
  const examples = {
    order: [
      { label: '차수+거래처 주문', text: '20-1차 꽃길 주문' },
      { label: '차수+품목 주문', text: '20-1차 카네이션 주문 합계' },
    ],
    stock: [
      { label: '차수 재고현황', text: '20-1차 카네이션 재고현황' },
      { label: '입고 농장/수량', text: '20-1차 로다스 입고농장 및 수량' },
    ],
    shipment: [
      { label: '차수 미확정 업체', text: '20-1차 미확정 업체' },
      { label: '거래처 출고', text: '20-1차 꽃길 출고' },
    ],
    sales: [
      { label: '이번 달 매출', text: '이번 달 매출' },
      { label: '거래처 매출', text: '꽃길 이번 달 매출' },
    ],
    receivable: [
      { label: '미수금 TOP', text: '미수금 상위 거래처' },
      { label: '거래처 미수금', text: '꽃길 미수금' },
    ],
  };
  return {
    messages: [
      {
        type: 'text',
        content: `질문 의도는 "${label}"로 이해했어요.\n다만 차수, 거래처, 품목 같은 기준이 부족해서 바로 답하면 틀릴 수 있습니다. 어떤 기준으로 볼까요?`,
      },
      {
        type: 'choices',
        prompt: '원하는 방향을 선택하거나 문장으로 한 번 더 적어주세요.',
        choices: (examples[intent] || []).map(x => ({
          ...x,
          payload: { intent },
        })),
      },
    ],
  };
}

function resultNeedsInvestigation(result) {
  if (!result || result._investigative || result._askback) return false;
  const messages = result.messages || [];
  const text = messages
    .filter(m => m.type === 'text' && m.content)
    .map(m => m.content)
    .join('\n');
  if (!text) return false;
  return /(없습니다|찾을 수 없습니다|찾지 못|이해하지 못|예시처럼|기준 확인|확정하지 못|바로 잡히지 않았습니다)/.test(text);
}

async function returnWithInvestigation(text, intent, result) {
  if (!resultNeedsInvestigation(result)) return result;
  const investigation = await buildInvestigativeClarification(text, intent).catch(() => null);
  if (!investigation) return result;
  return {
    ...investigation,
    messages: [
      ...(result.messages || []).slice(0, 1),
      ...investigation.messages,
    ],
  };
}

// ── 인텐트 분류 (우선순위 순)
function isZeroFilterFollowup(text) {
  return /(?:^|\s)(?:0|영|제로)\s*(?:제외|빼고|말고)|(?:잔량|재고|수량)\s*(?:있는|남은)\s*(?:것|거)?만|0\s*(?:아닌|이\s*아닌)/.test(String(text || ''));
}

function extractRowQty(row) {
  const value = String(row?.value || '').replace(/,/g, '');
  const fixed = value.match(/(?:확정|잔량|재고)\s*(-?\d+(?:\.\d+)?)/);
  if (fixed) return Number(fixed[1]);
  const equation = value.match(/=\s*(-?\d+(?:\.\d+)?)/);
  if (equation) return Number(equation[1]);
  const nums = value.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  return Number(nums[nums.length - 1]);
}

function cardsFromMessage(msg) {
  if (!msg) return [];
  if (msg.type === 'card' && msg.card) return [msg.card];
  if (msg.type === 'cards' && Array.isArray(msg.cards)) return msg.cards;
  return [];
}

function messagesFromServerHistory(history) {
  if (!Array.isArray(history)) return [];
  const messages = [];
  for (const turn of history) {
    for (const msg of (turn?.messages || [])) {
      messages.push({ role: 'bot', ...msg });
    }
  }
  return messages;
}

function filterPreviousCardRows(text, histories) {
  if (!isZeroFilterFollowup(text)) return null;
  const sources = Array.isArray(histories) ? histories : [histories];
  for (const history of sources) {
    if (!Array.isArray(history)) continue;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg = history[i];
      if (msg?.role !== 'bot') continue;
      const source = cardsFromMessage(msg).find(c => Array.isArray(c?.rows) && c.rows.length > 0);
      if (!source) continue;
      const rows = source.rows.filter(row => {
        const qty = extractRowQty(row);
        return qty === null ? true : qty !== 0;
      });
      return {
        messages: [
          {
            type: 'text',
            content: rows.length
              ? `제가 이해한 조건: 직전 조회 결과에서 수량/잔량이 0인 항목을 제외합니다.\n검색 경로: 이전 챗봇 카드 결과 → 행별 수량 판독 → 0 항목 제외.\n${rows.length}건입니다.`
              : '제가 이해한 조건: 직전 조회 결과에서 수량/잔량이 0인 항목을 제외합니다.\n검색 경로: 이전 챗봇 카드 결과 → 행별 수량 판독 → 0 항목 제외.\n표시할 항목이 없습니다.',
          },
          {
            type: 'card',
            card: {
              ...source,
              title: `${source.title || '이전 조회 결과'} - 0 제외`,
              rows: rows.slice(0, 80),
              footer: rows.length > 80 ? `총 ${rows.length}건 중 80건 표시` : `총 ${rows.length}건`,
            },
          },
        ],
        _contextFollowup: true,
      };
    }
  }
  return null;
}

function summarizeBotMessage(msg) {
  if (!msg) return '';
  if (msg.type === 'text') return String(msg.content || '');
  const cards = cardsFromMessage(msg);
  if (!cards.length) return '';
  return cards.map(c => {
    const rows = (c.rows || []).slice(0, 20).map(r => `${r.label}: ${r.value}`).join(', ');
    return `[${c.title || 'card'}${c.subtitle ? ` - ${c.subtitle}` : ''}] ${rows}${c.footer ? ` (${c.footer})` : ''}`;
  }).join('\n');
}

function clientHistoryToTurns(clientHistory) {
  if (!Array.isArray(clientHistory) || !clientHistory.length) return [];
  const turns = [];
  let pendingUser = '';
  for (const msg of clientHistory) {
    if (msg?.role === 'user') {
      pendingUser = String(msg.content || '');
      continue;
    }
    if (msg?.role === 'bot') {
      const botText = summarizeBotMessage(msg);
      if (botText) {
        turns.push({ userMessage: pendingUser, botText });
        pendingUser = '';
      }
    }
  }
  return turns.slice(-6);
}

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
  if (/(입고\s*농장|입고농장|농장.*수량|입고.*수량)/.test(text)) {
    return { intent: 'stock' };
  }
  if (/(업체별|거래처별).*(품목\s*수량|품목수량|품목별|수량)|(품목\s*수량|품목수량|품목별).*(업체별|거래처별)/.test(text)) {
    return { intent: 'shipment' };
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
export async function routeIntent(text, user, payload = null, options = {}) {
  const history = getHistory(user);
  const clientHistory = Array.isArray(options.clientHistory) ? options.clientHistory : [];
  const historyForAgent = history.length ? history : clientHistoryToTurns(clientHistory);

  if (!payload) {
    const filtered = filterPreviousCardRows(text, [clientHistory, messagesFromServerHistory(history)]);
    if (filtered) return filtered;
  }

  // 복잡 질의 (집계/순위/카운트) 는 고정 핸들러 건너뛰고 SQL 에이전트 직행
  if (!payload && isComplexQuery(text)) {
    const agent = await handleSqlAgent(text, { history: historyForAgent, userId: user?.userId });
    if (agent) return agent;
    // 에이전트도 실패하면 기존 흐름 계속
  }

  // 대화 맥락 필요한 후속 질문 감지 — 짧은 질문 + history 존재 + 지시어
  // 예: "박스 말고 단은?", "그거 합계만", "아까 그 품목", "단 단위만 보여줘"
  const hasDeicticFollowup = historyForAgent.length > 0 && (
    /(그거|이거|저거|아까|방금|이전|그\s|저\s|이\s|위에서|해당|그때)/.test(text) ||
    // 짧고 단위/숫자 언급만 있는 문장 — 전 질문 맥락 필수
    (text.length < 25 && /(단|박스|송이|개|건|%|원|만원|억)/.test(text))
  );
  if (!payload && hasDeicticFollowup) {
    const agent = await handleSqlAgent(text, { history: historyForAgent, userId: user?.userId });
    if (agent) return agent;
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

  if (llmPayload?._fromLLM && ['order', 'stock', 'shipment', 'sales', 'receivable'].includes(intent)) {
    const hasUsefulSlot = ['week', 'major', 'country', 'flower', 'period', 'mode', 'scope'].some(k => llmPayload[k]);
    if (!hasUsefulSlot) {
      const agent = await handleSqlAgent(text, { history: historyForAgent, userId: user?.userId });
      if (agent) return agent;
      return await buildInvestigativeClarification(text, intent);
    }
  }

  switch (intent) {
    case 'help':                   return await handleHelp(text, user, effectivePayload);
    case 'order':                  return await returnWithInvestigation(text, intent, await handleOrderLookup(text, user, effectivePayload));
    case 'stock':                  return await returnWithInvestigation(text, intent, await handleStockLookup(text, user, effectivePayload));
    case 'shipment':               return await returnWithInvestigation(text, intent, await handleShipmentLookup(text, user, effectivePayload));
    case 'sales':                  return await returnWithInvestigation(text, intent, await handleSalesLookup(text, user, effectivePayload));
    case 'receivable':             return await returnWithInvestigation(text, intent, await handleReceivableLookup(text, user, effectivePayload));
    case 'order_request_new':      return await handleOrderRequestFlow(text, user, 'new');
    case 'order_request_pending':  return await handleOrderRequestFlow(text, user, 'pending');
    default: {
      // 최종 fallback: Text-to-SQL 에이전트
      const agentResult = await handleSqlAgent(text, { history: historyForAgent });
      if (agentResult) return agentResult;
      const investigative = await buildInvestigativeClarification(text, 'unknown');
      if (investigative) return investigative;
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
