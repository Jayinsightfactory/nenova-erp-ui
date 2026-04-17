// pages/api/orders/parse-paste.js
// POST { text } → Claude로 거래처/품목 분석 → { custMatch, items[] }

import Anthropic from '@anthropic-ai/sdk';
import { query, sql } from '../../../lib/db';
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

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 필요' });

  try {
    // 거래처 + 품목 목록 DB에서 로드
    const [custRes, prodRes] = await Promise.all([
      query(`SELECT CustKey, CustName, CustArea FROM Customer WHERE isDeleted=0 ORDER BY CustName`),
      query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName FROM Product WHERE isDeleted=0 ORDER BY ProdName`),
    ]);

    const customers = custRes.recordset;
    const products  = prodRes.recordset;

    const custList = customers.map(c => `${c.CustKey}|${c.CustName}|${c.CustArea || ''}`).join('\n');
    const prodList = products.map(p => `${p.ProdKey}|${p.ProdName}|${p.DisplayName}|${p.FlowerName}|${p.CounName}`).join('\n');

    const client = getClient();
    if (!client) return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY 없음' });

    const systemPrompt = `너는 꽃 도매 ERP 주문 파싱 전문가다.
사용자가 붙여넣은 텍스트를 분석해서 거래처와 품목 목록을 추출한다.

텍스트 형식 예시:
- 첫 줄: 거래처명 (단독 줄)
- 이후 줄: "품목명 | 수량" 또는 "품목명 : 수량" 또는 "품목명  수량"

반드시 유효한 JSON만 출력. 설명/주석 금지.

응답 스키마:
{
  "custKey": <number | null>,
  "custName": "<string | null>",
  "items": [
    {
      "inputName": "<원본 품목명>",
      "qty": <number>,
      "prodKey": <number | null>,
      "prodName": "<DB ProdName | null>",
      "displayName": "<DB DisplayName | null>"
    }
  ]
}

규칙:
- custKey: 거래처 목록에서 가장 유사한 거래처의 CustKey. 없으면 null.
- prodKey: 품목 목록에서 가장 유사한 품목의 ProdKey. 영문 품종명(Caroline, Moon Light 등)은 ProdName에서 찾는다. 없으면 null.
- 품목명은 부분 포함 매칭 허용 (예: "Caroline" → ProdName에 "CAROLINE" 포함된 것)
- qty가 명시 안 되면 1로 처리`;

    const userMsg = `거래처 목록:\n${custList}\n\n품목 목록:\n${prodList}\n\n파싱할 텍스트:\n${text}`;

    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 3000,
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

    // custKey로 거래처 정보 보강
    let custMatch = null;
    if (parsed.custKey) {
      custMatch = customers.find(c => c.CustKey === parsed.custKey) || null;
    } else if (parsed.custName) {
      custMatch = customers.find(c => c.CustName?.includes(parsed.custName) || parsed.custName?.includes(c.CustName)) || null;
    }

    // prodKey로 품목 정보 보강
    const items = (parsed.items || []).map(item => {
      const prod = item.prodKey ? products.find(p => p.ProdKey === item.prodKey) : null;
      return {
        inputName:   item.inputName,
        qty:         item.qty || 1,
        prodKey:     prod?.ProdKey  || null,
        prodName:    prod?.ProdName || item.prodName || null,
        displayName: prod?.DisplayName || item.displayName || null,
        flowerName:  prod?.FlowerName  || null,
        counName:    prod?.CounName    || null,
      };
    });

    return res.status(200).json({ success: true, custMatch, items });
  } catch (err) {
    console.error('[parse-paste]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
