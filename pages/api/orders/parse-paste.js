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
import { loadMappings, normalizeToken, findMappingFuzzy, detectFallbackProdKey } from '../../../lib/parseMappings';

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
  // 카네이션 품종 (Carnation varieties) — 2026-04-28 확장
  '캐롤라인': 'CAROLINE',
  '캐롤라인골드': 'CAROLINE GOLD',
  '카라멜': 'CARAMEL',
  '사파리': 'SAFARI',
  '레드팬서': 'PANTHER',
  '팬서': 'PANTHER',
  '문라이트': 'MOON LIGHT',
  '문골렘': 'MOON GOLEM',
  '돈셀': 'DONCEL',
  '돈페드로': 'DON PEDRO',
  '돈루이스': 'DON LUIS',
  '노비아': 'NOVIA',
  '헤르메스': 'HERMES',
  '헤르메스오렌지': 'HERMES ORANGE',
  '오렌지헤르메스': 'HERMES ORANGE',
  '라이온킹': 'LION KING',
  '라이언킹': 'LION KING',
  '메건': 'MEGAN',
  '웨딩': 'WEDDING',
  '체리오': 'CHERRIO',
  '치리오': 'CHERRIO',
  '프론테라': 'FRONTERA',
  '레드프론테라': 'RED FRONTERA',
  '클리아워터': 'CLEAR WATER',
  '클리어워터': 'CLEAR WATER',
  '만달레이': 'MANDALAY',
  '코마치': 'KOMACHI',
  '마루치': 'MARUCHI',
  '마리포사': 'MARIPOSA',
  '카오리': 'KAORI',
  '이케바나': 'IKEBANA',
  '폴림니아': 'POLIMNIA',
  '폴립니아': 'POLIMNIA',
  '마제스타': 'MAJESTA',
  '브루트': 'BRUT',
  '브르트': 'BRUT',
  '로다스': 'RODAS',
  '로시타': 'ROSITA',
  '쥬리고': 'ZURIGO',
  '아틱': 'ARCTIC',
  '네스': 'NES',
  '딜리타': 'DILETTA',
  '지오지아': 'GIOGIA',
  '애플티': 'APPLE TEA',
  '립스틱': 'LIPS',
  '일루션': 'ILUSION',
  '일루젼': 'ILUSION',
  '유카리': 'YUKARI',
  '유카리체리': 'YUKARI CHERRY',
  '바카라': 'BACARAT',
  '골렘': 'GOLEM',
  '캐서린': 'CATHERINE',
  '시저': 'CESAR',
  '시저레드': 'CESAR RED',
  '바이올렛퀸': 'VIOLET QUEEN',
  '믹스박스a': 'MIX BOX A',
  '믹스박스b': 'MIX BOX B',
  '믹스박스c': 'MIX BOX C',
  '믹스박스d': 'MIX BOX D',
  '믹스박스e': 'MIX BOX E',
  '믹스': 'MIX',
  '핑크': 'PINK',
  '핑크몬디알': 'PINK MONDIAL',
  '몬디알': 'MONDIAL',
  '퀵샌드': 'QUICK SAND',
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

export const config = { api: { responseLimit: false, bodyParser: { sizeLimit: '1mb' } } };

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 필요' });

  try {
    // ── Step 1: 텍스트 첫 줄에서 꽃 품종 키워드 선(先) 추출
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const koTokensAll = (text.match(/[가-힣]+/g) || []);
    const detectedFlowers = [...new Set(koTokensAll.flatMap(t => KO_EN_KEYWORDS[t] ? [KO_EN_KEYWORDS[t]] : []))];

    // ── Step 2: 꽃 품종 기준으로 DB에서 해당 품목만 조회 (없으면 전체 최대 300)
    let prodFilter = '';
    if (detectedFlowers.length > 0) {
      prodFilter = detectedFlowers.map(f => `FlowerName LIKE '%${f}%' OR ProdName LIKE '%${f}%'`).join(' OR ');
    }
    const [custRes, prodRes, allProdRes, unitRes] = await Promise.all([
      query(`SELECT CustKey, CustName, CustArea FROM Customer WHERE isDeleted=0 ORDER BY CustName`),
      query(`SELECT TOP 300 ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName, OutUnit
             FROM Product WHERE isDeleted=0 ${prodFilter ? `AND (${prodFilter})` : ''}
             ORDER BY ProdName`),
      query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName, OutUnit
             FROM Product WHERE isDeleted=0
             ORDER BY ProdName`),
      query(`SELECT ProdKey,
               SUM(ISNULL(BoxQuantity,0))   AS TotalBox,
               SUM(ISNULL(BunchQuantity,0)) AS TotalBunch,
               SUM(ISNULL(SteamQuantity,0)) AS TotalSteam
             FROM OrderDetail WHERE isDeleted=0 AND ProdKey IS NOT NULL GROUP BY ProdKey`, {}),
    ]);

    const customers = custRes.recordset;
    const products  = prodRes.recordset;
    const allProducts = allProdRes.recordset;
    const productByKey = new Map(allProducts.map(p => [Number(p.ProdKey), p]));

    // 품목별 이력 단위 맵 빌드
    const prodUnitMap = {};
    for (const row of unitRes.recordset) {
      const b = row.TotalBox, d = row.TotalBunch, s = row.TotalSteam;
      if (b === 0 && d === 0 && s === 0) continue;
      if (d >= b && d >= s)      prodUnitMap[row.ProdKey] = '단';
      else if (s >= b && s >= d) prodUnitMap[row.ProdKey] = '송이';
      else                       prodUnitMap[row.ProdKey] = '박스';
    }

    // ── Step 3: 영문 토큰으로 2차 필터링 (추가 정밀도)
    const enDirect = text.split(/[\s\n|:,→]+/).map(t => t.trim().toUpperCase()).filter(t => t.length >= 4 && /^[A-Z]/.test(t));
    const searchTokens = [...new Set([...detectedFlowers, ...enDirect])];
    const filteredProducts = searchTokens.length > 0
      ? products.filter(p => {
          const name = (p.ProdName || '').toUpperCase();
          return searchTokens.some(tok => name.includes(tok));
        })
      : products;
    const prodForClaude = filteredProducts.length >= 3 ? filteredProducts : products;

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
핑크몬디알=PINK MONDIAL, 몬디알=MONDIAL
퀵샌드=QUICK SAND
캐롤라인=CAROLINE, 카라멜=CARAMEL, 사파리=SAFARI, 레드팬서=RED PANTHER

규칙:
- 거래처명 줄: 단독 줄, 숫자/단위/동작어 없음
- 품목줄: "{품종명} {수량}{단위} {추가|취소}" 또는 "{품종명} | {수량}"
- action: "추가"(기본) 또는 "취소"
- unit 결정 규칙 (★ 매우 중요):
  ★ 기본값: 박스 (90%+ 케이스)
  ★ "장미"는 단 (예: 프리덤, 몬디알, 캔들라이트 등 ROSE 품목)
  ★ 입력에 명시 단위 있으면 그대로 (단/박스/송이)
  ★ 단위 누락 ("루스커스 1 취소", "마리포사 1 추가") → 박스 로 강제 (장미 외)
  ★ 단/송이 단위가 장미 외 품목에서 등장하면 → 사용자가 의도적으로 단수로 입력한 것이므로 그대로 유지하되,
    품목 매칭 신뢰도 낮으면 prodKey=null 로 두어 사용자 수동 확인하게 함
- 괄호 () 안 내용은 모두 메모 → 무시
  ★ "(총 50단)" 같은 표시는 최종 분배값 참고용. 추가/취소 수량과 무관.
  ★ "(21번 박스)", "(33,34번 박스)" 도 위치 메모. 무시.
  예: "프라우드 A급 2단 추가 (총 50단)" → qty=2, unit=단, action=추가 (50 무시)
  예: "루어샨 10단 취소 (21번 박스)" → qty=10, unit=단 (21 무시)
- 등급 표시 ("A급", "B급") 는 품종명에 포함 (예: "프라우드 A급" 통째로 inputName)
- qty 명시 없으면 1
- "→ 출고", "오늘 출고 부탁드립니다", 날짜 관련 줄 무시
- 같은 거래처가 여러 섹션에 나오면 섹션마다 별도 order
- 거래처 이체 패턴 (한 거래처 취소 + 다른 거래처 추가 같은 품목):
  ★ 각각 별개 라인으로 처리. 두 order 모두 생성.
  예:  "남대문 중앙 - 헤르메스 오렌지 1박스 취소"  → 남대문 중앙 order (CANCEL)
       "친구플라워 - 헤르메스 오렌지 1박스 추가"  → 친구플라워 order (ADD)

품목 매칭 우선순위 (★ CountryFlower 추론):
- 같은 품종이 여러 국가에 있을 때 (예: "프라우드"가 중국장미와 콜롬비아장미에 모두 존재):
  ★ 텍스트에 "중국" 키워드 포함 → CountryFlower='중국장미' 우선
  ★ "콜" / "콜롬비아" 키워드 포함 → CountryFlower='콜롬비아장미' 우선
  ★ "에콰" / "에콰도르" → 에콰도르장미
  ★ 키워드 없으면 → 콜롬비아 default (가장 흔한 산지)
  ★ 섹션 헤더에 "중국 변경사항" 같이 국가 명시되면 그 섹션 전체 적용
- custKey: 거래처 목록에서 가장 유사한 CustKey, 없으면 null
- prodKey: 위 규칙대로 CountryFlower 추론 후 매칭. 못 찾으면 null (사용자 수동 매칭)

차수(week) 추출:
- 섹션 헤더(예: "16-1 수국 변경사항", "16-01", "16주차 1차")에서 차수 감지
- 형식: "WW-SS" (예: "16-01", "16-2" → "16-02")
- 텍스트에 차수 표시 없으면 null

반드시 유효한 JSON만 출력. 설명/주석 금지.

응답 스키마:
{
  "detectedWeek": "<WW-SS 형식 or null>",
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

    const resp = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Claude API 응답 시간 초과 (30초)')), 30000)),
    ]);

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
      const normCust = s => String(s || '').replace(/\s+/g, '').toLowerCase();
      if (order.custKey) {
        custMatch = customers.find(c => c.CustKey === order.custKey) || null;
      }
      if (!custMatch && order.custName) {
        const orderCust = normCust(order.custName);
        const candidates = customers.filter(c => {
          const custName = normCust(c.CustName);
          return custName === orderCust || custName.includes(orderCust) || orderCust.includes(custName);
        });
        candidates.sort((a, b) =>
          Math.abs(normCust(a.CustName).length - orderCust.length) -
          Math.abs(normCust(b.CustName).length - orderCust.length)
        );
        custMatch = candidates[0] || null;
      }

      // 매번 파일에서 새로 로드 (학습 후 재배포 없이 즉시 반영)
      const savedMappings = loadMappings(true);
      const items = (order.items || []).map(item => {
        // 1순위: 서버 저장 매핑 (사용자 학습 데이터) — 정확 매치 + fuzzy 부분 매치
        const fuzzyMatch = findMappingFuzzy(item.inputName, savedMappings);
        const savedMap = fuzzyMatch ? fuzzyMatch.value : null;
        const mappedProd = savedMap ? productByKey.get(Number(savedMap.prodKey)) : null;

        // 2순위: Claude 파싱 결과
        const claudeProd = item.prodKey ? productByKey.get(Number(item.prodKey)) : null;

        const prod = mappedProd || claudeProd;
        const unit = defaultUnit(prod, item.unit, prodUnitMap);
        // confidence 점수 계산
        // - 학습매핑 exact: 1.0
        // - 학습매핑 fuzzy: fuzzyMatch.score (0~1)
        // - LLM 매칭: 0.6
        // - 매칭 실패: 0.0
        let confidence = 0;
        let confidenceLabel = 'none';
        if (mappedProd) {
          confidence = fuzzyMatch?.score ?? 1;
          confidenceLabel = fuzzyMatch?.matchType === 'exact' ? 'high' : 'medium';
        } else if (claudeProd) {
          confidence = 0.6;
          confidenceLabel = 'medium';
        }
        // fallback 의심 검사: 매칭된 prodKey 가 너무 많은 입력에 매핑되어 있나?
        const fallbackInfo = prod ? detectFallbackProdKey(prod.ProdKey) : { isFallback: false, count: 0 };
        if (fallbackInfo.isFallback) {
          confidence = Math.min(confidence, 0.4);
          confidenceLabel = 'low';
        }
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
          fromMapping: !!mappedProd,
          mappingMatchType: fuzzyMatch?.matchType || null,
          mappingMatchKey:  fuzzyMatch?.key || null,
          confidence,                       // 0.0 ~ 1.0
          confidenceLabel,                  // 'high' | 'medium' | 'low' | 'none'
          fallbackSuspect: fallbackInfo.isFallback,  // 같은 prodKey 가 N+개 입력에 매핑되어 있으면 true
          fallbackCount:   fallbackInfo.count,
        };
      });

      return { custMatch, items };
    });

    // 차수 정규화: "16-1" → "16-01"
    let detectedWeek = parsed.detectedWeek || null;
    if (detectedWeek) {
      const m = String(detectedWeek).match(/^(\d{1,2})-(\d{1,2})$/);
      if (m) detectedWeek = `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    }

    return res.status(200).json({ success: true, orders, prodUnitMap, detectedWeek });
  } catch (err) {
    console.error('[parse-paste]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
