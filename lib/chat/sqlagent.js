// lib/chat/sqlagent.js — Text-to-SQL 에이전트 (범용 자연어 질의)
//
// 파이프라인:
//   ① LLM #1 (haiku) → 스키마 + 카탈로그 + 질문 → SQL 생성
//   ② sqlguard → SELECT only / TOP 강제 / 위험 패턴 거부
//   ③ DB 실행 (5s 타임아웃, 100행 상한)
//   ④ LLM #2 (haiku) → 질문 + SQL + 결과 → 한국어 답변 + 카드
//   하이브리드: 1차 haiku, 실행 에러면 sonnet 으로 재시도 (1회)
//
// 호출부: router 의 최종 fallback.  반환 실패시 null → 호출부가 "이해 못함" 처리.

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db';
import { getSchemaPrompt } from './schema';
import { getCatalog } from './catalog';
import { validateSql } from './sqlguard';
import { getCodePatternPrompt } from './codePatterns';
import { formatHistoryForPrompt } from './memory';
import { getUsagePrompt } from '../apiLogger';
import { getBizContextPrompt } from './bizContext';

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

const MODEL_FAST = 'claude-haiku-4-5';
const MODEL_STRONG = 'claude-sonnet-4-5';

// ── 1차 프롬프트: SQL 생성
async function askGenerateSQL(client, model, userMessage, { schemaText, catalogHint, codeHint = '', historyHint = '', previousError }) {
  const system = `너는 MSSQL T-SQL 전문가다. 사용자의 한국어 질문을 읽고 **단일 SELECT 쿼리** 를 생성한다.

엄격 규칙:
1. 오직 SELECT (또는 WITH CTE) 만. INSERT/UPDATE/DELETE/DROP 등 금지.
2. 반드시 'TOP 100' 포함 (스칼라 집계 COUNT/SUM/AVG 는 예외).
3. 세미콜론 사용 금지.
4. 스키마에 실존하는 테이블/컬럼만 사용.
5. isDeleted=0 필터 필수 (해당 컬럼 있는 경우).
6. 날짜 범위: GETDATE() 기준. "오늘"=CONVERT(date,GETDATE()), "어제"=DATEADD(day,-1,...), "이번달"=YEAR/MONTH 일치, "지난달"=DATEADD(month,-1,...), "작년"=YEAR(GETDATE())-1.
7. CATALOG 에 있는 국가/꽃/지역 명칭만 조건에 사용.
8. 결과는 JSON 으로만 출력: {"sql": "SELECT ...", "purpose": "한줄 요약"}
9. JSON 외의 설명/주석 금지. 마크다운 금지.
10. 결과가 1건 예상되면 스칼라 집계 사용. 목록이면 TOP 20~100 사용.

${schemaText}

${catalogHint}

${codeHint}

${historyHint}`;

  const messages = [{ role: 'user', content: userMessage }];
  if (previousError) {
    messages.push({
      role: 'assistant',
      content: `{"sql":"(이전 시도)","purpose":""}`,
    });
    messages.push({
      role: 'user',
      content: `이전 쿼리 실행 오류: "${previousError}" — 스키마를 다시 확인하고 다른 쿼리로 재시도하세요. JSON 만 반환.`,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await client.messages.create(
      { model, max_tokens: 2000, system, messages },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const text = (resp.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const json = (text.match(/\{[\s\S]*\}/) || [null])[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (!parsed.sql) return null;
    return parsed;
  } catch (e) {
    clearTimeout(timer);
    console.error('[sqlagent.gen]', e.message);
    return null;
  }
}

// ── 2차 프롬프트: 결과 → 답변 포매팅
async function askFormatAnswer(client, model, userMessage, sql, rows, purpose) {
  // 전체 행 LLM 에게 전달 (잘림 방지) — 최대 150행, JSON 12KB 까지
  const rowsSlice = rows.slice(0, 150);
  const preview = JSON.stringify(rowsSlice, null, 0).slice(0, 12000);

  const system = `너는 꽃 도매 ERP 챗봇의 답변 작성자다.
사용자 질문, 실행한 SQL, 실제 결과 행이 주어진다.
다음 JSON 형식으로만 응답:
{
  "text": "한국어 2-3문장 요약 답변. 숫자는 천단위 콤마",
  "card": {
    "title": "간결한 카드 제목",
    "subtitle": "(선택) 부제",
    "rows": [ { "label": "...", "value": "..." } ],  // 모든 결과 행 포함 (최대 150개)
    "footer": "(선택) 풋터 문구"
  }
}

규칙:
- card.rows 가 비면 card 필드 자체를 생략.
- 결과가 0건이면 text 에 "해당 조건의 데이터가 없습니다" + card 생략.
- **결과 행이 많아도 생략 금지 — 받은 전체 행을 rows 에 그대로 담아라** (품목/거래처 누락 X).
- 숫자 값에 단위 꼭 포함 (원, 단, 송이, BOX, 건 등).
- 금지: JSON 외 설명. 마크다운.`;

  const userContent = [
    `질문: ${userMessage}`,
    `의도: ${purpose || '-'}`,
    `SQL: ${sql}`,
    `결과 (${rows.length}행):`,
    preview,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: userContent }],
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const text = (resp.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const json = (text.match(/\{[\s\S]*\}/) || [null])[0];
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    clearTimeout(timer);
    console.error('[sqlagent.fmt]', e.message);
    return null;
  }
}

// ── 실패 시 역질문 생성 (LLM 이 사용자에게 되묻기)
async function askClarification(client, userMessage, lastError, historyHint) {
  const system = `너는 꽃 도매 ERP 챗봇이다. 방금 사용자 질문에 답을 찾지 못했다.
"이해하지 못했다" 라고 끝내지 말고, 사용자에게 **구체적인 역질문** 을 해서 의도를 명확히 해라.

반드시 JSON 으로만 출력:
{
  "text": "한국어 역질문 1~2문장. 무엇이 불명확한지 + 어떤 정보를 주면 도움될지 질문.",
  "choices": [ { "label": "선택지 텍스트", "text": "이 버튼 누르면 보낼 메시지" } ]
}

예:
- "꽃길 매출" 질문인데 어느 기간 모를 때 → "꽃길 매출은 어느 기간으로 조회할까요?" + [오늘/이번주/이번달/작년] 버튼
- "16차 물량" 인데 세부차수 모를 때 → "16차 중 어느 세부차수?" + [16-01/16-02 전체] 버튼
- 완전히 모호한 경우 → "어떤 데이터를 보고 싶으세요?" + [주문/출고/재고/매출] 버튼

규칙:
- choices 는 2~4개, 사용자가 한 번 더 터치하면 바로 답 나올 수 있는 구체적 질문.
- JSON 외 텍스트/마크다운 금지.`;

  const userContent = `사용자 질문: "${userMessage}"
실행 실패 원인: ${lastError || '알 수 없음'}

${historyHint || ''}

역질문 JSON 만 반환.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await client.messages.create(
      { model: MODEL_FAST, max_tokens: 600, system,
        messages: [{ role: 'user', content: userContent }] },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const json = (text.match(/\{[\s\S]*\}/) || [null])[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (!parsed.text) return null;
    const msgs = [{ type: 'text', content: `🤔 ${parsed.text}` }];
    if (parsed.choices && parsed.choices.length > 0) {
      msgs.push({
        type: 'actions',
        actions: parsed.choices.map(c => ({ label: c.label, text: c.text })),
      });
    }
    return { messages: msgs, _askback: true };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

// ── DB 실행 (타임아웃·행 상한)
async function runSql(sqlText) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('쿼리 타임아웃 (8s)')), 8000)
  );
  const r = await Promise.race([query(sqlText, {}), timeoutPromise]);
  const rows = r?.recordset || [];
  return { rows, rowCount: rows.length };
}

// ── 메인: 사용자 메시지 → 답변 (messages 형식) 또는 null
// history: Array<{userMessage, botText, payload}> — 최근 대화 턴
// userId: 사용자 ID (API 사용량 프롬프트용)
export async function handleSqlAgent(userMessage, { history = [], userId = null } = {}) {
  const client = getClient();
  if (!client) return null; // 키 없으면 호출부가 기본 fallback 처리

  let schemaText = '';
  let catalogHint = '';
  let codeHint = '';
  let historyHint = '';
  try {
    schemaText = await getSchemaPrompt();
    const cat = await getCatalog();
    catalogHint = `## CATALOG (실존 값)
COUNTRIES: ${cat.countries.map(c => c.name).join(', ')}
FLOWERS: ${cat.flowers.map(f => f.name).slice(0, 80).join(', ')}
AREAS: ${cat.areas.join(', ')}`;
    codeHint = await getCodePatternPrompt({ max: 10 }).catch(() => '');
    historyHint = formatHistoryForPrompt(history);
    // API 사용량 기반 관심사 힌트
    const usageHint = getUsagePrompt(userId);
    if (usageHint) catalogHint += '\n\n' + usageHint;
    // 실제 경영 현황 (DB 직접 집계)
    const bizHint = await getBizContextPrompt().catch(() => '');
    if (bizHint) catalogHint += '\n\n' + bizHint;
  } catch (e) {
    console.error('[sqlagent.prep]', e.message);
    return null;
  }

  // ── 1차 시도: haiku
  let attempt = await askGenerateSQL(client, MODEL_FAST, userMessage, {
    schemaText, catalogHint, codeHint, historyHint,
  });
  let lastError = null;
  let rows = null;
  let finalSql = null;
  let finalPurpose = null;

  for (let i = 0; i < 2; i++) {
    if (!attempt || !attempt.sql) break;
    const guard = validateSql(attempt.sql);
    if (!guard.ok) {
      lastError = `SQL 검증 실패: ${guard.reason}`;
      attempt = null;
      break;
    }
    try {
      const exec = await runSql(guard.sql);
      rows = exec.rows;
      finalSql = guard.sql;
      finalPurpose = attempt.purpose;
      break; // 성공
    } catch (e) {
      lastError = e.message || String(e);
      // 1차 실패 → sonnet 으로 재시도 (1회)
      if (i === 0) {
        attempt = await askGenerateSQL(client, MODEL_STRONG, userMessage, {
          schemaText, catalogHint, codeHint, historyHint, previousError: lastError,
        });
        continue;
      }
      attempt = null;
    }
  }

  if (!finalSql || rows === null) {
    console.error('[sqlagent] final failure:', lastError);
    // 실패 대신 역질문 시도 (LLM 에게 사용자 질문 명확히 만들도록 요청)
    const askBack = await askClarification(client, userMessage, lastError, historyHint).catch(() => null);
    if (askBack) return askBack;
    return null;
  }

  // ── 2차 시도: 답변 포매팅
  const formatted = await askFormatAnswer(client, MODEL_FAST, userMessage, finalSql, rows, finalPurpose);

  // 포매팅 실패해도 결과는 보여주기 (fallback: 원본 JSON 짧게)
  if (!formatted) {
    const preview = rows.length === 0
      ? '결과가 없습니다.'
      : `${rows.length}건 조회됨.`;
    return {
      messages: [
        { type: 'text', content: `🔎 ${finalPurpose || '쿼리 실행'}\n${preview}` },
      ],
      _debug: { sql: finalSql, rowCount: rows.length },
    };
  }

  const msgs = [{ type: 'text', content: formatted.text || `🔎 ${finalPurpose}` }];
  if (formatted.card && formatted.card.rows && formatted.card.rows.length) {
    msgs.push({ type: 'card', card: formatted.card });
  }
  return { messages: msgs, _debug: { sql: finalSql, rowCount: rows.length } };
}
