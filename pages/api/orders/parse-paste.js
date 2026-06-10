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

import { defaultUnit, normalizeOrderUnit } from '../../../lib/orderUtils';
import { loadMappings, normalizeToken, findMappingFuzzy, detectFallbackProdKey } from '../../../lib/parseMappings';
import { loadCustomerMappings, findCustomerMapping } from '../../../lib/customerMappings';
import { scoreMatch } from '../../../lib/displayName';

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
  '알스트로메리아': 'ALSTROEMERIA',
  '휘슬러': 'WHISTLER',
  '스타티스': 'STATICE',
  '호주': '호주',
  '소재': '호주',
  '화이트': 'WHITE',
  '연핑크': 'LIGHT',
  '진핑크': 'DEEP PINK',
  '진그린': 'DARK GREEN',
  '연그린': 'LIGHT GREEN',
  '블루': 'BLUE',
  '라벤다': 'LAVENDER',
  '라벤더': 'LAVENDER',
  '피치': 'PEACH',
  '태국': '태국',
  '진다': 'JINDA',
  '진다스위트': 'JINDA SWEET',
  '진다 스위트': 'JINDA SWEET',
  '진다스윗': 'JINDA SWEET',
  '진다 스윗': 'JINDA SWEET',
  '진다스윗트': 'JINDA SWEET',
  '진다 스윗트': 'JINDA SWEET',
  '코랄리프': 'CORAL',
  '레몬잎': 'SALAL TIPS',
  '솔리다고': 'SOLIDAGO',
  // 카네이션 품종 (Carnation varieties) — 2026-04-28 확장
  '캐롤라인': 'CAROLINE',
  '캐롤라인골드': 'CAROLINE GOLD',
  '캐롤라인 골드': 'CAROLINE GOLD',
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
  '헤르메스 오렌지': 'HERMES ORANGE',
  '헤르메르오렌지': 'HERMES ORANGE',
  '헤르메르 오렌지': 'HERMES ORANGE',
  '헤르메오렌지': 'HERMES ORANGE',
  '오렌지헤르메스': 'HERMES ORANGE',
  '오랜지헤르메스': 'HERMES ORANGE',
  '라이온킹': 'LION KING',
  '라이언킹': 'LION KING',
  '메건': 'MEGAN',
  '웨딩': 'WEDDING',
  '베로나핑크': 'VERONA PINK',
  '베로나 핑크': 'VERONA PINK',
  '피치맘보': 'PEACH MAMBO',
  '로다스크림': 'RODAS CREAM',
  '로다스 크림': 'RODAS CREAM',
  '딜레타': 'DILETTA',
  '딜레타크림': 'DILETTA CREAM',
  '딜레타 크림': 'DILETTA CREAM',
  '딜레타크리미': 'DILETTA CREAM',
  '딜레타크리미아': 'DILETTA CREAM',
  '딜레타옐로우': 'DILETTA YELLOW',
  '딜레타엘로우': 'DILETTA YELLOW',
  '딜레타 노랑': 'DILETTA YELLOW',
  '고블린': 'GOBLIN',
  '엠마': 'EMMA',
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
  '주리고': 'ZURIGO',
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
  '핑크코벳': 'PINK CORVETTE',
  '로얄다마스커스': 'ROYAL DAMASCUS',
  'sp화이트': 'SP WHITE',
  'sp크림': 'SP CREAM',
  'sp연핑크': 'SP PINK',
  'sp피치': 'SP PEACH',
  '믹스박스a': 'MIX BOX A',
  '믹스박스b': 'MIX BOX B',
  '믹스박스c': 'MIX BOX C',
  '믹스박스d': 'MIX BOX D',
  '믹스박스e': 'MIX BOX E',
  '믹스': 'MIX',
  '핑크': 'PINK',
  '핑크몬디알': 'PINK MONDIAL',
  '몬디알': 'MONDIAL',
  '몬디알화이트': 'MONDIAL WHITE',
  '몬디알 화이트': 'MONDIAL WHITE',
  '화이트몬디알': 'MONDIAL WHITE',
  '화이트 몬디알': 'MONDIAL WHITE',
  '퀵샌드': 'QUICK SAND',
  '플라야': 'PLAYA BLANCA',
  '플라야블랑카': 'PLAYA BLANCA',
  '플라야 블랑카': 'PLAYA BLANCA',
  '프리덤': 'FREEDOM',
  '프라우드': 'PROUD',
  '프라우드레드': 'PROUD RED',
  '쉬머': 'SHIMMER',
  '오션송': 'OCEAN SONG',
  '하츠': 'HARTS',
  '비스윗': 'BE SWEET',
  '비스위트': 'BE SWEET',
  '비 스윗': 'BE SWEET',
  '오렌지퀸': 'ORANGE QUEEN',
  '오랜지퀸': 'ORANGE QUEEN',
  '크림컵': 'CREAM CUP',
  '크림 컵': 'CREAM CUP',
  '버터컵': 'BUTTERCUP',
  '안슬레이': 'ANNESLEY',
  '로맨틱비치': 'ROMANTIC BEACH',
  '로맨틱 비치': 'ROMANTIC BEACH',
  '다이아나': 'DIANA',
  // 호주 소재 품목
  '바커부쉬': 'BANKER BUSH',
  '반커부쉬': 'BANKER BUSH',
  '뱅커부쉬': 'BANKER BUSH',
  '에뮤그라스': 'EMU GRASS',
  '에뮤글라스': 'EMU GRASS',
  '스틸그라스': 'STEEL GRASS',
  '코알라': 'KOALA FERN',
  '코알라펀': 'KOALA FERN',
  '엄브렐라': 'FERN UMBRELLA',
  '엄브렐러': 'FERN UMBRELLA',
  '엄브렐라펀': 'FERN UMBRELLA',
  '엄브렐러펀': 'FERN UMBRELLA',
  '엄블렐라펀': 'FERN UMBRELLA',
  '레인보우': 'FERN RAINBOW',
  '레인보우펀': 'FERN RAINBOW',
  '씨스타': 'FERN SEA STAR',
  '씨스타펀': 'FERN SEA STAR',
  '시스타': 'FERN SEA STAR',
  '시스타펀': 'FERN SEA STAR',
  '에뮤페더': 'EMU FEATHER',
  '에뮤페터': 'EMU FEATHER',
  '스테노카르푸스': 'STENOCARPUS',
  '스테노': 'STENOCARPUS',
  '코퍼글로우': 'COPPER GLOW',
  '쿠퍼글로우': 'COPPER GLOW',
  '울리부쉬그린': 'WOLLY BUSH GREEN TIP',
  '울리부쉬': 'WOLLY BUSH',
  '울리브러시': 'WOLLY BUSH',
  '울리브러쉬': 'WOLLY BUSH',
  '구아나클라우': 'GOANNA CLAW',
  '구아나클로우': 'GOANNA CLAW',
  '구아나크로우': 'GOANNA CLAW',
  '고아나클로우': 'GOANNA CLAW',
  '고아나클라우': 'GOANNA CLAW',
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
  // ── 수입방 빈출 꽃 종류(genus) — 2026-06-05. LLM 후보 SQL 필터가 해당 품목군을 포함하도록.
  '알륨': 'ALLIUM',
  '아가판서스': 'AGAPANTHUS',
  '아가판투스': 'AGAPANTHUS',
  '에린지움': 'ERYNGIUM',
  '스키미아': 'SKIMMIA',
  '스키미야': 'SKIMMIA',
  '히아신스': 'HYACINTH',
  '히야신스': 'HYACINTH',
  '안시리움': 'ANTHURIUM',
  '안스리움': 'ANTHURIUM',
  '안슬리움': 'ANTHURIUM',
  '그라시오사': 'GRACIOSA',
  '카라': 'CALLA',
  '칼라': 'CALLA',
};

export const config = { api: { responseLimit: false, bodyParser: { sizeLimit: '1mb' } } };

function sanitizePasteText(raw) {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => !/^[ㅡ\-_=\s]{5,}$/.test(line))
    .join('\n')
    .replace(/춰소|츼소|치소|취ㅅ|ㅊ소/g, '취소');
}

function parseCompactQty(value) {
  const n = parseFloat(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseCompactWeek(line) {
  const s = String(line || '');
  let m = s.match(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?:\s*차)?(?:\s|$)/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/(?:^|\s)(\d{1,2})\s*차(?:\s|$)/);
  return m ? `${m[1].padStart(2, '0')}-01` : null;
}

/** 한글 키워드 사전 — 토큰 분리 없이 부분 문자열로도 꽃/품종 필터 추출 */
function detectKoEnFromText(text) {
  const found = new Set();
  const src = String(text || '');
  const keys = Object.keys(KO_EN_KEYWORDS).sort((a, b) => b.length - a.length);
  for (const ko of keys) {
    if (src.includes(ko)) found.add(KO_EN_KEYWORDS[ko]);
  }
  return [...found];
}

function parseCompactFlowerContext(line, currentFlower = '') {
  const m = String(line || '').match(/(수국|장미|카네이션|카네|알스트로(?:메리아)?|루스커스|호주|레몬잎|호접|덴파레|리시안|튤립)/);
  if (!m) return currentFlower;
  if (m[1] === '카네') return '카네이션';
  if (m[1] === '리시안') return '리시안셔스';
  return m[1];
}

function parseCompactProductHead(line) {
  const beforeParen = String(line || '').split('(')[0] || '';
  const beforeAngle = beforeParen.split('<')[0].trim();
  if (!beforeAngle) return '';
  const m = beforeAngle.match(/^(.+?)[\s:：]*-?\d+(?:\.\d+)?\s*(박스|단|송이|개)?$/);
  return (m ? m[1] : beforeAngle).trim();
}

function parseCompactChangeToken(token) {
  const s = String(token || '').replace(/\s+/g, '').trim();
  if (!s || /미발주|사용예정|예정|시작|여분|메모|참고|입고|재고/.test(s) || /\d+\s*개/.test(s)) return null;

  let m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)>(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const before = parseCompactQty(m[2]);
    const after = parseCompactQty(m[3]);
    return { custName: m[1], delta: after - before, raw: token };
  }

  m = s.match(/^(.+?)취소(-?\d+(?:\.\d+)?)$/) || s.match(/^(.+?)(-?\d+(?:\.\d+)?)취소$/);
  if (m) return { custName: m[1], delta: -Math.abs(parseCompactQty(m[2])), raw: token };

  m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)추가$/) || s.match(/^(.+?)추가(-?\d+(?:\.\d+)?)$/);
  if (m) return { custName: m[1], delta: Math.abs(parseCompactQty(m[2])), raw: token };

  m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)$/);
  if (m && !/^\d/.test(m[1])) return { custName: m[1], delta: Math.abs(parseCompactQty(m[2])), raw: token, assumed: true };

  return null;
}

function parseCompactInlinePrefixChanges(line) {
  const changes = [];
  const re = /([가-힣A-Za-z0-9]+)\s*\(\s*(-?\d+(?:\.\d+)?)\s*>\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  let m;
  while ((m = re.exec(String(line || ''))) !== null) {
    const before = parseCompactQty(m[2]);
    const after = parseCompactQty(m[3]);
    changes.push({ custName: m[1], delta: after - before, raw: `${m[1]}${m[2]}>${m[3]}` });
  }
  return changes;
}

function parseCompactStockOrders(text) {
  const orderMap = new Map();
  let detectedWeek = null;
  let flowerContext = '';
  let mode = 'regular';

  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (/^[\s\-_=ㅡ─]{4,}$/.test(line)) {
      if (mode === 'extra') mode = 'regular';
      return;
    }

    const lineWeek = parseCompactWeek(line);
    if (lineWeek) {
      detectedWeek = detectedWeek || lineWeek;
      flowerContext = parseCompactFlowerContext(line, flowerContext);
      if (/여분\s*주문|여분주문/.test(line)) mode = 'extra';
      if (/변경사항/.test(line)) mode = 'regular';
      if (/여분\s*주문|여분주문|변경사항|차\s*$|^\d{1,2}\s*-\s*\d{1,2}\s*$/.test(line)) return;
    }
    if (mode === 'extra') return;
    if (!line.includes('(')) return;

    const productName = parseCompactProductHead(line);
    if (!productName) return;
    const inputName = flowerContext && !String(productName).includes(flowerContext)
      ? `${flowerContext} ${productName}`
      : productName;

    const changes = parseCompactInlinePrefixChanges(line);
    [...line.matchAll(/\(([^)]*)\)/g)].forEach(m => {
      const change = parseCompactChangeToken(m[1]);
      if (change) changes.push(change);
    });

    changes.forEach(change => {
      if (!change.custName || !change.delta) return;
      const qty = Math.abs(change.delta);
      if (!(qty > 0)) return;
      const key = change.custName;
      if (!orderMap.has(key)) orderMap.set(key, { custKey: null, custName: key, items: [] });
      orderMap.get(key).items.push({
        inputName,
        qty,
        unit: '박스',
        action: change.delta > 0 ? '추가' : '취소',
        prodKey: null,
        prodName: null,
        displayName: null,
      });
    });
  });

  return { detectedWeek, orders: [...orderMap.values()].filter(o => o.items.length > 0) };
}

function normalizeFlowerContext(line) {
  const s = String(line || '').trim().replace(/\s+/g, '');
  if (s === '카네') return '카네이션';
  if (/^알스트로(?:메리아)?$/i.test(s)) return '알스트로';
  return /^(수국|장미|카네이션|알스트로|루스커스|호주|레몬잎|호접|덴파레|리시안셔스|튤립)$/.test(s) ? s : '';
}

function applyFlowerContext(name, flowerContext) {
  const productName = String(name || '').trim();
  if (!productName || !flowerContext) return productName;
  return productName.includes(flowerContext) ? productName : `${flowerContext} ${productName}`;
}

// 자연어 파서 단위 정규화 — 한글 "스팀/스템"(stem) → 송이, 없으면 품종 기본단위.
function normNatUnit(u, flowerContext) {
  const raw = String(u || '').trim();
  if (/스팀|스템|stems?|steam/i.test(raw)) return '송이';
  if (raw) return raw;
  return flowerContext === '장미' ? '단' : '박스';
}

function isNaturalCustomerLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (/추가|취소|[()<>]/.test(s)) return false;
  if (/^\d{1,2}\s*(?:-\s*\d{1,2})?\s*차?\s*$/.test(s)) return false;
  if (/\d+\s*(박스|단|송이|개|ea|box|bunch|stem|stems)/i.test(s)) return false;
  return true;
}

function parseNaturalSectionOrders(text) {
  const orderMap = new Map();
  let detectedWeek = null;
  let currentCust = '';
  let flowerContext = '';
  let sectionAction = '';

  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line || /^[\s\-_=ㅡ─]{4,}$/.test(line)) return;

    const lineWeek = parseCompactWeek(line);
    const explicitHeaderFlowerContext = parseCompactFlowerContext(line, '');
    const headerLooksLikeSection = /(변경사항|추가|취소|재고|잔량|출고일)/.test(line);
    if (headerLooksLikeSection && explicitHeaderFlowerContext) {
      flowerContext = explicitHeaderFlowerContext;
    }
    if (!lineWeek && headerLooksLikeSection && /추가|취소/.test(line) && explicitHeaderFlowerContext && !/\d+\s*(박스|단|송이|개)/.test(line)) {
      sectionAction = normalizeAction(line);
      return;
    }
    if (lineWeek) {
      detectedWeek = detectedWeek || lineWeek;
      flowerContext = parseCompactFlowerContext(line, flowerContext);
      sectionAction = /추가|취소|춰소|츼소|치소|쥐소/.test(line) ? normalizeAction(line) : '';
      const lineWithoutWeek = line.replace(/(?:^|\s)\d{1,2}\s*(?:-\s*\d{1,2})?\s*차?/, ' ');
      if (explicitHeaderFlowerContext && /추가|취소/.test(line) && !/\d+\s*(박스|단|송이|개)/.test(lineWithoutWeek)) return;
      if (/변경사항|차\s*$|^\d{1,2}\s*-\s*\d{1,2}\s*$/.test(line)) return;
      // 차수가 붙은 줄에 수량(숫자)이 없으면 섹션 헤더(예: "23-2 중국 발주 추가",
      //  "23-2차 네덜란드 발주 추가") → 품목 아님. 소비하고 다음 줄로(여분코드 오등록 방지).
      const headerRemainder = lineWithoutWeek.replace(/추가|취소|발주|변경사항|재고|잔량|출고/g, ' ').trim();
      if (!/\d/.test(headerRemainder)) return;
    }

    const flowerOnly = normalizeFlowerContext(line);
    if (flowerOnly) {
      flowerContext = flowerOnly;
      return;
    }

    const m = line.match(/^(.+?)\s*(-?\d+(?:\.\d+)?)?\s*(박스|단|송이|개|스팀|스템|stems?|steam)?\s*(추가|취소)\s*$/i);
    if (m && (currentCust || sectionAction)) {
      const custName = currentCust || '여분코드';
      const qty = Math.abs(parseCompactQty(m[2] || '1')) || 1;
      const productName = applyFlowerContext(m[1].trim(), flowerContext);
      const unit = normNatUnit(m[3], flowerContext);
      if (!orderMap.has(custName)) orderMap.set(custName, { custKey: null, custName, items: [] });
      orderMap.get(custName).items.push({
        inputName: productName,
        qty,
        unit,
        unitExplicit: !!m[3],
        action: m[4] || sectionAction,
        prodKey: null,
        prodName: null,
        displayName: null,
      });
      return;
    }

    const qtyOnly = line.match(/^(.+?)\s*(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개|스팀|스템|stems?|steam)?\s*$/i);
    if (qtyOnly && (currentCust || sectionAction)) {
      const custName = currentCust || '여분코드';
      const qty = Math.abs(parseCompactQty(qtyOnly[2] || '1')) || 1;
      const productName = applyFlowerContext(qtyOnly[1].trim(), flowerContext);
      const unit = normNatUnit(qtyOnly[3], flowerContext);
      if (!orderMap.has(custName)) orderMap.set(custName, { custKey: null, custName, items: [] });
      orderMap.get(custName).items.push({
        inputName: productName,
        qty,
        unit,
        unitExplicit: !!qtyOnly[3],
        action: sectionAction || '추가',
        prodKey: null,
        prodName: null,
        displayName: null,
      });
      return;
    }

    if (isNaturalCustomerLine(line)) {
      currentCust = line;
    }
  });

  return { detectedWeek, orders: [...orderMap.values()].filter(o => o.items.length > 0) };
}

function normalizeAction(action, inputName = '') {
  const s = `${action || ''} ${inputName || ''}`;
  if (/취소|cancel|delete|삭제/i.test(s)) return '취소';
  return '추가';
}

function hasExplicitCountry(text) {
  return /(중국|china|콜롬비아|colombia|콜장미|에콰도르|에콰|ecuador)/i.test(String(text || ''));
}

function extractCm(text) {
  const m = String(text || '').match(/(\d{2})\s*(?:cm|센치)/i);
  return m ? Number(m[1]) : null;
}

function productCm(prod) {
  return extractCm(`${prod?.ProdName || ''} ${prod?.DisplayName || ''}`);
}

function isRoseProduct(prod) {
  const text = `${prod?.FlowerName || ''} ${prod?.ProdName || ''} ${prod?.DisplayName || ''}`;
  return /(장미|rose)/i.test(text);
}

function countryKey(prod) {
  return String(prod?.CounName || '').trim().toLowerCase() || 'unknown';
}

function isMixBoxName(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /믹스\s*박스|mix\s*box|mixbox/.test(text);
}

function inputWantsMixBox(inputName) {
  return /믹스\s*박스|믹스|mix\s*box|mixbox|mixed/i.test(String(inputName || ''));
}

function isMixBoxMismatch(inputName, prod) {
  return isMixBoxName(prod) && !inputWantsMixBox(inputName);
}

function isFreightOrChargeProduct(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/.test(text);
}

function inputWantsFreight(inputName) {
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/i.test(String(inputName || ''));
}

function isFreightMismatch(inputName, prod) {
  return isFreightOrChargeProduct(prod) && !inputWantsFreight(inputName);
}

function resolveRoseCandidate(item, chosenProd, allProducts) {
  const input = item?.inputName || item?.prodName || item?.displayName || '';
  const isRoseInput = /(장미|rose)/i.test(input) || isRoseProduct(chosenProd);
  if (!isRoseInput) return { prod: chosenProd, ambiguousCountry: false, reason: null };

  const explicitCountry = hasExplicitCountry(input);
  const explicitCm = extractCm(input);
  let candidates = allProducts
    .filter(isRoseProduct)
    .filter(prod => !isFreightMismatch(input, prod))
    .map(prod => ({ prod, score: scoreMatch(input, prod, '') }))
    .filter(x => x.score >= 70)
    .sort((a, b) => b.score - a.score);

  if (explicitCm) {
    const lengthMatches = candidates.filter(x => productCm(x.prod) === explicitCm);
    if (lengthMatches.length) candidates = lengthMatches;
  } else {
    // 장미 길이 미기재 시 운영 기본값은 50cm. 40cm 자동 매칭을 방지한다.
    const cm50 = candidates.filter(x => productCm(x.prod) === 50);
    if (cm50.length) candidates = cm50;
  }

  if (candidates.length === 0) {
    return { prod: chosenProd, ambiguousCountry: false, reason: null };
  }

  const topScore = candidates[0].score;
  const top = candidates.filter(x => x.score >= topScore - 5);
  const countries = new Set(top.map(x => countryKey(x.prod)));

  if (!explicitCountry && countries.size > 1) {
    return {
      prod: null,
      ambiguousCountry: true,
      reason: '같은 장미 품종이 여러 국가에 있어 국가 선택 필요',
    };
  }

  return { prod: top[0].prod, ambiguousCountry: false, reason: null };
}

function findBestProductCandidate(inputName, allProducts) {
  const input = String(inputName || '').trim();
  if (!input) return null;
  const scored = allProducts
    .filter(prod => !isMixBoxMismatch(input, prod))
    .filter(prod => !isFreightMismatch(input, prod))
    .map(prod => ({ prod, score: scoreMatch(input, prod, '') }))
    .filter(x => x.score >= 72)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const topScore = scored[0].score;
  const nearTop = scored.filter(x => x.score >= topScore - 3);
  const nearKeys = new Set(nearTop.map(x => Number(x.prod.ProdKey)));
  if (nearKeys.size > 1) return null;
  return scored[0].prod;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 필요' });
  const cleanText = sanitizePasteText(text);

  try {
    // ── Step 1: 텍스트 첫 줄에서 꽃 품종 키워드 선(先) 추출
    const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
    const detectedFlowers = detectKoEnFromText(cleanText);

    // ── Step 2: 꽃 품종 기준으로 DB에서 해당 품목만 조회 (없으면 전체 최대 300)
    let prodFilter = '';
    if (detectedFlowers.length > 0) {
      prodFilter = detectedFlowers.map(f => `FlowerName LIKE '%${f}%' OR ProdName LIKE '%${f}%' OR CounName LIKE '%${f}%'`).join(' OR ');
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
    const customerByKey = new Map(customers.map(c => [Number(c.CustKey), c]));
    const savedCustomerMappings = loadCustomerMappings(true);

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
    const enDirect = cleanText.split(/[\s\n|:,→]+/).map(t => t.trim().toUpperCase()).filter(t => t.length >= 4 && /^[A-Z]/.test(t));
    const searchTokens = [...new Set([...detectedFlowers, ...enDirect])];
    const filteredProducts = searchTokens.length > 0
      ? products.filter(p => {
          const haystack = `${p.ProdName || ''} ${p.DisplayName || ''} ${p.FlowerName || ''} ${p.CounName || ''}`.toUpperCase();
          return searchTokens.some(tok => haystack.includes(String(tok || '').toUpperCase()));
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
호주=AUSTRALIA/호주 CounName. "16차 호주 추가" 섹션은 호주 소재 품목으로 해석.

품종명 한→영:
화이트=WHITE, 연핑크=LIGHT PINK, 블루=BLUE, 코랄리프=CORAL REEF
핑크몬디알=PINK MONDIAL, 몬디알=MONDIAL
퀵샌드=QUICK SAND
호주 소재:
바커부쉬/반커부쉬/뱅커부쉬=BANKER BUSH, 에뮤그라스/에뮤글라스=EMU GRASS, 에뮤페더/에뮤페터=EMU FEATHER,
스틸그라스=STEEL GRASS, 코알라/코알라펀=KOALA FERN,
엄브렐라/엄브렐러/엄브렐라펀/엄브렐러펀/엄블렐라펀=FERN UMBRELLA,
레인보우/레인보우펀=FERN RAINBOW, 씨스타/시스타/씨스타펀/시스타펀=FERN SEA STAR,
스테노/스테노카르푸스=STENOCARPUS, 코퍼글로우/쿠퍼글로우=COPPER GLOW,
울리부쉬그린=WOLLY BUSH GREEN TIP, 울리부쉬/울리브러시=WOLLY BUSH,
구아나클라우/구아나클로우/구아나크로우/고아나클로우=GOANNA CLAW
캐롤라인=CAROLINE, 카라멜=CARAMEL, 사파리=SAFARI, 레드팬서=RED PANTHER

규칙:
- 거래처명 줄: 단독 줄, 숫자/단위/동작어 없음
- 품목줄: "{품종명} {수량}{단위} {추가|취소}" 또는 "{품종명} | {수량}"
- action: "추가"(기본) 또는 "취소"
- "춰소", "츼소", "치소" 같은 오타는 "취소"로 해석
- unit 결정 규칙 (★ 매우 중요):
  ★ 기본값: 박스 (90%+ 케이스)
  ★ "장미"는 단 (예: 프리덤, 몬디알, 캔들라이트 등 ROSE 품목)
  ★ 장미 길이가 없으면 50cm 를 기본으로 본다. 40cm 로 임의 매칭하지 말 것.
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
  ★ 키워드 없고 동일 품종이 여러 국가에 있으면 → prodKey=null (사용자 수동 선택)
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

    const userMsg = `거래처 목록:\n${custList}\n\n품목 목록:\n${prodList}\n\n파싱할 텍스트:\n${cleanText}`;

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
    const compactParsed = parseCompactStockOrders(cleanText);
    const naturalParsed = parseNaturalSectionOrders(cleanText);
    const baseParsedOrders = naturalParsed.orders?.length ? naturalParsed.orders : (parsed.orders || []);
    const mergedParsedOrders = [...baseParsedOrders, ...(compactParsed.orders || [])];

    // 거래처·품목 보강
    const orders = mergedParsedOrders.map(order => {
      let custMatch = null;
      const normCust = s => String(s || '').replace(/\s+/g, '').toLowerCase();
      const savedCustMap = findCustomerMapping(order.custName, savedCustomerMappings);
      if (savedCustMap?.value?.custKey) {
        custMatch = customerByKey.get(Number(savedCustMap.value.custKey)) || null;
      }
      if (!custMatch && order.custKey) {
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
        const savedMappedProd = savedMap ? productByKey.get(Number(savedMap.prodKey)) : null;
        const savedFallbackInfo = savedMappedProd
          ? detectFallbackProdKey(savedMappedProd.ProdKey, fuzzyMatch?.key)
          : { isFallback: false, count: 0 };
        const legacyFallbackMapping = !!fuzzyMatch && savedMap?.auto === true && savedFallbackInfo.isFallback;
        const mappedProd = (
          legacyFallbackMapping ||
          isMixBoxMismatch(item.inputName, savedMappedProd) ||
          isFreightMismatch(item.inputName, savedMappedProd)
        ) ? null : savedMappedProd;

        // 2순위: Claude 파싱 결과
        const claudeProd = item.prodKey ? productByKey.get(Number(item.prodKey)) : null;
        const scoredProd = (!mappedProd && !claudeProd) ? findBestProductCandidate(item.inputName, allProducts) : null;

        const resolved = resolveRoseCandidate(item, mappedProd || claudeProd || scoredProd, allProducts);
        const prod = resolved.prod;
        const unit = item.unitExplicit
          ? normalizeOrderUnit(item.unit, '박스')
          : defaultUnit(prod, item.unit, prodUnitMap);
        // confidence 점수 계산
        // - 학습매핑 exact: 1.0
        // - 학습매핑 fuzzy: fuzzyMatch.score (0~1)
        // - LLM 매칭: 0.6
        // - 매칭 실패: 0.0
        let confidence = 0;
        let confidenceLabel = 'none';
        if (resolved.ambiguousCountry) {
          confidence = 0;
          confidenceLabel = 'none';
        } else if (mappedProd) {
          confidence = fuzzyMatch?.score ?? 1;
          confidenceLabel = fuzzyMatch?.matchType === 'exact' ? 'high' : 'medium';
        } else if (claudeProd) {
          confidence = 0.6;
          confidenceLabel = 'medium';
        } else if (scoredProd) {
          confidence = 0.55;
          confidenceLabel = 'medium';
        }
        // fallback 의심 검사: 매칭된 prodKey 가 너무 많은 입력에 매핑되어 있나?
        const fallbackInfo = prod ? detectFallbackProdKey(prod.ProdKey) : { isFallback: false, count: 0 };
        const mappingLooksSpecific = !!fuzzyMatch && !legacyFallbackMapping && (
          fuzzyMatch.matchType === 'exact' ||
          fuzzyMatch.matchType === 'compact' ||
          Number(fuzzyMatch.score || 0) >= 0.5
        );
        if (fallbackInfo.isFallback && !mappingLooksSpecific) {
          confidence = Math.min(confidence, 0.4);
          confidenceLabel = 'low';
        }
        return {
          inputName:   item.inputName,
          qty:         item.qty || 1,
          unit,
          action:      normalizeAction(item.action, item.inputName),
          prodKey:     prod?.ProdKey  || null,
          prodName:    prod?.ProdName || item.prodName || null,
          displayName: prod?.DisplayName || item.displayName || null,
          flowerName:  prod?.FlowerName  || null,
          counName:    prod?.CounName    || null,
          fromMapping: !!mappedProd && Number(mappedProd.ProdKey) === Number(prod?.ProdKey),
          mappingMatchType: (!!mappedProd && Number(mappedProd.ProdKey) === Number(prod?.ProdKey)) ? (fuzzyMatch?.matchType || null) : null,
          mappingMatchKey:  (!!mappedProd && Number(mappedProd.ProdKey) === Number(prod?.ProdKey)) ? (fuzzyMatch?.key || null) : null,
          ambiguousCountry: resolved.ambiguousCountry,
          ambiguityReason:  resolved.reason,
          confidence,                       // 0.0 ~ 1.0
          confidenceLabel,                  // 'high' | 'medium' | 'low' | 'none'
          fallbackSuspect: fallbackInfo.isFallback && !mappingLooksSpecific,  // 같은 prodKey 가 N+개 입력에 매핑되어 있으면 true
          fallbackCount:   fallbackInfo.count,
        };
      });

      return {
        custName: order.custName || '',
        custMatch,
        custFromMapping: !!savedCustMap && !!custMatch,
        custMappingKey: savedCustMap?.key || null,
        items,
      };
    });

    // 차수 정규화: "16-1" → "16-01"
    let detectedWeek = naturalParsed.detectedWeek || parsed.detectedWeek || null;
    if (detectedWeek) {
      const m = String(detectedWeek).match(/^(\d{1,2})-(\d{1,2})$/);
      if (m) detectedWeek = `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    }
    if (!detectedWeek && compactParsed.detectedWeek) detectedWeek = compactParsed.detectedWeek;

    return res.status(200).json({ success: true, orders, prodUnitMap, detectedWeek });
  } catch (err) {
    console.error('[parse-paste]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
