// lib/chat/llm.js — Claude API 의도 파악 (대화 기능 전용)
//
// 역할:
//   룰 기반 분류가 실패했을 때, 사용자 자연어 메시지를 LLM 으로 분석해
//   구조화된 intent JSON 을 반환한다.
//
// 안전장치:
//   - ANTHROPIC_API_KEY 없으면 null 반환 (호출부는 기존 fallback 으로 진행)
//   - 네트워크/파싱 에러도 null 반환 (챗봇 기능 죽지 않음)
//   - 응답 짧게 (max_tokens=400), 5초 타임아웃
//
// 반환 intent 스키마 (룰 기반 classify 와 호환):
//   {
//     intent: 'order'|'stock'|'shipment'|'sales'|'receivable'|
//             'order_request_new'|'order_request_pending'|'help'|'unknown',
//     week?:     '16-01' | null,
//     major?:    '16'    | null,
//     country?:  '네덜란드' | null,    // 원산지 (Product.CounName)
//     flower?:   '장미'   | null,      // 꽃 종류 (Product.FlowerName)
//     custName?: '꽃길'   | null,
//     period?:   'today'|'yesterday'|'thisWeek'|'thisMonth'|'lastMonth'|'lastYear'|null,
//     mode?:     'byItem'|'total'|null,
//     scope?:    'customer'|'origin'|'flower'|null
//   }
//
// 환각 방지: catalog 요약(실제 DB 에 존재하는 국가/꽃/지역 목록) 을 프롬프트에 주입.

import Anthropic from '@anthropic-ai/sdk';
import { getCatalog } from './catalog';
import { getBizContextPrompt } from './bizContext';
import { trackLLMCall } from './costTracker';

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM_PROMPT = `너는 꽃 도매 ERP 챗봇의 의도 파악기다. 사용자 메시지를 JSON 으로 변환한다.

반드시 유효한 JSON 한 덩어리만 출력한다. 설명/주석 금지.

스키마:
{
  "intent": "order" | "stock" | "shipment" | "sales" | "receivable" | "order_request_new" | "order_request_pending" | "help" | "unknown",
  "week":     null | "NN-NN"  // 세부차수 예: "16-01"
  "major":    null | "NN"     // 대차수만 언급된 경우 예: "16"
  "country":  null | string   // 꽃 원산지 (국가명). DB 에 실존하는 값만.
  "flower":   null | string   // 꽃 종류. DB 에 실존하는 값만.
  "custName": null | string   // 거래처 이름 또는 그 일부
  "period":   null | "today"|"yesterday"|"thisWeek"|"thisMonth"|"lastMonth"|"lastYear"
  "mode":     null | "byItem" | "total"
  "scope":    null | "customer" | "origin" | "flower"
}

규칙:
- intent 는 반드시 하나. 확신 없으면 "unknown".
- "원산지" "산" "나라" 가 붙으면 scope="origin", country 세팅.
- 거래처 언급이면 scope="customer", custName 세팅.
- "합계만" "총" → mode="total". "품목별" "목록" → mode="byItem".
- 차수 "16-1","16-01","16차1" 은 week="16-01". "16차"만 단독이면 major="16", week=null.
- country / flower 는 반드시 아래 CATALOG 에 있는 값 중 하나만 허용. 없으면 null.`;

export async function inferIntentWithLLM(userMessage) {
  const client = getClient();
  if (!client) return null;

  let catalogHint = '';
  try {
    const cat = await getCatalog();
    const countries = cat.countries.map(c => c.name).slice(0, 40).join(', ');
    const flowers   = cat.flowers.map(f => f.name).slice(0, 60).join(', ');
    catalogHint = `\n\nCATALOG (DB 에 실존):\nCOUNTRIES: ${countries}\nFLOWERS: ${flowers}`;
    const bizHint = await getBizContextPrompt().catch(() => '');
    if (bizHint) catalogHint += '\n\n' + bizHint;
  } catch (_) { /* catalog 없어도 LLM 은 호출 가능 */ }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const resp = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: SYSTEM_PROMPT + catalogHint,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timer);
    trackLLMCall({
      userId: null, model: 'claude-haiku-4-5',
      inputTokens: resp?.usage?.input_tokens || 0,
      outputTokens: resp?.usage?.output_tokens || 0,
      purpose: 'intent',
    });

    const text = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // JSON 만 추출 (```json ... ``` 같은 마크다운 래핑 제거)
    const jsonText = (text.match(/\{[\s\S]*\}/) || [null])[0];
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || !parsed.intent) return null;
    return parsed;
  } catch (err) {
    console.error('[llm] inference failed:', err.message);
    return null;
  }
}
