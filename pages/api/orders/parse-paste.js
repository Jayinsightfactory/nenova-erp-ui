// pages/api/orders/parse-paste.js
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { trackLLMCall } from '../../../lib/chat/costTracker';

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

import { defaultUnit } from '../../../lib/orderUtils';

// 한국어 → 영문 키워드 매핑 (품목 사전필터링용)
const KO_EN_KEYWORDS = {
  '장미': 'ROSE', '로즈': 'ROSE',
  '카네이션': 'CARNATION', '카네': 'CARNATION',
  '수국': 'HYDRANGEA',
  '루스커스': 'RUSCUS',
  '콜': 'COL',
  '튤립': 'TULIP',
  '거베라': 'GERBERA',
  '리시안': 'LISIANTHUS',
  '국화': 'CHRYSANTHEMUM',
  '안개': 'GYPSOPHILA',
  '해바라기': 'SUNFLOWER',
  '알스트로': 'ALSTROEMERIA',
  '스타티스': 'STATICE',
  '화이트': 'WHITE',
  '연핑크': 'LIGHT',
  '블루': 'BLUE',
  '코랄리프': 'CORAL',
  '캐롤라인': 'CAROLINE',
  '카라멜': 'CARAMEL',
  '사파리': 'SAFARI',
  '레드팬서': 'PANTHER',
  '팬서': 'PANTHER',
  '문라이트': 'MOON',
  '핑크': 'PINK',
  '레드': 'RED',
  '옐로': 'YELLOW',
  '오렌지': 'ORANGE',
  '퍼플': 'PURPLE',
  '라벤더': 'LAVENDER',
  '그린': 'GREEN',
  '크림': 'CREAM',
  '살몬': 'SALMON',
  '버건디': 'BURGUNDY',
  '샴페인': 'CHAMPAGNE',
};

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 필요' });

  try {
    const [custRes, prodRes] = await Promise.all([
      query(`SELECT CustKey, CustName, CustArea FROM Customer WHERE isDeleted=0 ORDER BY CustName`),
      query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName FROM Product WHERE isDeleted=0 ORDER BY ProdName`),
    ]);

    const customers = custRes.recordset;
    const products  = prodRes.recordset;

    // 한국어 토큰 → 영문 키워드로 관련 품목 필터링
    const koTokens = (text.match(/[가-힣]+/g) || []);
    const enFromKo = [...new Set(koTokens.flatMap(t => KO_EN_KEYWORDS[t] ? [KO_EN_KEYWORDS[t]] : []))];
    const enDirect = text.split(/[\s\n|:,→]+/).map(t => t.trim().toUpperCase()).filter(t => t.length >= 4 && /^[A-Z]/.test(t));
    const searchTokens = [...new Set([...enFromKo, ...enDirect])];

    const filteredProducts = searchTokens.length > 0
      ? products.filter(p => {
          const name = (p.ProdName || '').toUpperCase();
          return searchTokens.some(tok => name.includes(tok));
        })
      : [];
    // 너무 적으면 전체 폴백
    const prodForClaude = filteredProducts.length >= 5 ? filteredProducts : products;

    const custList = customers.map(c => `${c.CustKey}|${c.CustName}|${c.CustArea || ''}`).join('\n');
    const prodList = prodForClaude.map(p => `${p.ProdKey}|${p.ProdName}|${p.DisplayName}|${p.FlowerName}|${p.CounName}`).join('\n');

    const client = getClient();
    if (!client) return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY 없음' });

    const systemPrompt = `너는 꽃 도매 ERP 주문 파싱 전문가다. 다양한 형식의 텍스트에서 거래처와 품목을 추출한다.

--- 형식 A (기본): 거래처명 한 줄, 이후 품목 ---
청화꽃집
Caroline | 2
수국 화이트 3박스

--- 형식 B (변경사항): 섹션 헤더 + 거래처별 품목 ---
16-1 수국 변경사항
미우
화이트 3박스 취소
연핑크 2박스 추가

공주
블루 1박스 추가

섹션 헤더(예: "16-1 수국 변경사항")에서 꽃종류(수국) 추출.
품목명 = 꽃종류 + 품종명 (예: "수국 화이트", "수국 블루")

--- 형식 C (인라인): "거래처명 : 품목명 수량 동작" ---
주광 : 카라멜 1박스 취소

꽃 한→영 (ProdName 검색):
장미=ROSE, 카네이션=CARNATION, 수국=HYDRANGEA, 루스커스=RUSCUS, 콜=COL, 콜장미=COL ROSE

품종명 한→영:
화이트=WHITE, 연핑크=LIGHT PINK, 블루=BLUE, 코랄리프=CORAL REEF
캐롤라인=CAROLINE, 카라멜=CARAMEL, 사파리=SAFARI, 레드팬서=RED PANTHER

규칙:
- 거래처명 줄: 단독 줄, 숫자/단위/동작어 없음
- 품목줄: "{품종명} {수량}{단위} {추가|취소}" 또는 "{품종명} | {수량}"
- action: "추가"(기본) 또는 "취소"
- unit 결정 규칙: 장미(ROSE)→단, 네덜란드산→단, 나머지→박스, 송이 단위면 송이
- qty 명시 없으면 1
- "→ 출고", "오늘 출고 부탁드립니다", 날짜 관련 줄 무시
- 같은 거래처가 여러 섹션에 나오면 섹션마다 별도 order
- custKey: 거래처 목록에서 가장 유사한 CustKey, 없으면 null
- prodKey: 품목 목록에서 가장 유사한 ProdKey (꽃종류+품종명 조합으로 검색), 없으면 null

반드시 유효한 JSON만 출력. 설명/주석 금지.

응답 스키마:
{
  "orders": [
    {
      "custKey": <number|null>,
      "custName": "<string>",
      "items": [
        {
          "inputName": "<꽃종류 포함 품목명, 예: 수국 화이트>",
          "qty": <number>,
          "unit": "박스"|"단"|"송이",
          "action": "추가"|"취소",
          "prodKey": <number|null>,
          "prodName": "<DB ProdName|null>",
          "displayName": "<DB DisplayName|null>"
        }
      ]
    }
  ]
}`;

    const userMsg = `거래처 목록:\n${custList}\n\n품목 목록:\n${prodList}\n\n파싱할 텍스트:\n${text}`;

    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    trackLLMCall({
      userId: req.user?.userId || null,
      model: 'claude-haiku-4-5',
      inputTokens:  resp?.usage?.input_tokens  || 0,
      outputTokens: resp?.usage?.output_tokens || 0,
      purpose: 'parse-paste',
    });

    const raw = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const jsonText = (raw.match(/\{[\s\S]*\}/) || [null])[0];
    if (!jsonText) return res.status(500).json({ success: false, error: 'LLM 응답 파싱 실패' });

    const parsed = JSON.parse(jsonText);

    // 거래처·품목 보강
    const orders = (parsed.orders || []).map(order => {
      let custMatch = null;
      if (order.custKey) {
        custMatch = customers.find(c => c.CustKey === order.custKey) || null;
      }
      if (!custMatch && order.custName) {
        custMatch = customers.find(c =>
          c.CustName?.includes(order.custName) || order.custName?.includes(c.CustName)
        ) || null;
      }

      const items = (order.items || []).map(item => {
        const prod = item.prodKey ? products.find(p => p.ProdKey === item.prodKey) : null;
        const unit = defaultUnit(prod, item.unit);
        return {
          inputName:   item.inputName,
          qty:         item.qty || 1,
          unit,
          action:      item.action || '추가',
          prodKey:     prod?.ProdKey  || null,
          prodName:    prod?.ProdName || item.prodName || null,
          displayName: prod?.DisplayName || item.displayName || null,
          flowerName:  prod?.FlowerName  || null,
          counName:    prod?.CounName    || null,
        };
      });

      return { custMatch, items };
    });

    return res.status(200).json({ success: true, orders });
  } catch (err) {
    console.error('[parse-paste]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
