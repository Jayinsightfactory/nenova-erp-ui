// lib/displayName.js — 품목 자연어 표시명 유틸리티
// DB의 ProdName(영문 코드)을 한글 자연어명(DisplayName)으로 변환/매칭

// ── 복합어 먼저 (단어 단위 치환보다 우선)
const PHRASE_MAP = [
  ['PLAYA BLANCA',  '플라야블랑카'],
  ['PINK MONDIAL',  '핑크몬디알'],
  ['QUICK SAND',    '퀵샌드'],
  ['QUICKSAND',     '퀵샌드'],
  ['MOON LIGHT',    '문라이트'],
  ['MOONLIGHT',     '문라이트'],
  ['HOT PINK',      '핫핑크'],
  ['LIGHT PINK',    '라이트핑크'],
  ['DEEP PINK',     '딥핑크'],
  ['BABY PINK',     '베이비핑크'],
  ['SOFT PINK',     '소프트핑크'],
  ['BELLA VITA',    '벨라비타'],
  ['SAN REMO',      '산레모'],
  ['LA VIE',        '라비'],
  ['DE AMOR',       '데아모르'],
  ['TRES CHIC',     '트레쉬크'],
  ['CHERRY BRANDY', '체리브랜디'],
  ['GOLDEN GATE',   '골든게이트'],
  ['SWEET AKITO',   '스위트아키토'],
  ['ROYAL AKITO',   '로얄아키토'],
  ['TERRA NOSTRA',  '테라노스트라'],
  ['EL TORO',       '엘토로'],
  ['NINA BELLA',    '니나벨라'],
  ['SUPER NOVA',    '슈퍼노바'],
  ['BICOLOR MYSTERY', '바이컬러미스터리'],
];

// ── 꽃 종류 (초반 토큰으로 인식)
const FLOWER_MAP = {
  'HYDRANGEA':     '수국',
  'CARNATION':     '카네이션',
  'ROSE':          '장미',
  'ALSTROEMERIA':  '알스트로',
  'ALSTROMERIA':   '알스트로',
  'ALSTRO':        '알스트로',
  'RUSCUS':        '루스커스',
  'ACACIA':        '아카시아',
  'CHRYSANTHEMUM': '국화',
  'LILY':          '백합',
  'TULIP':         '튤립',
  'GERBERA':       '거베라',
  'LISIANTHUS':    '리시안셔스',
  'GYPSOPHILA':    '안개꽃',
  'STATICE':       '스타티체',
  'FREESIA':       '프리지아',
  'ANTHURIUM':     '안스리움',
  'ORCHID':        '난',
};

// ── 품종 / 수식어 단어
const WORD_MAP = {
  'WHITE':    '화이트',
  'RED':      '레드',
  'PINK':     '핑크',
  'YELLOW':   '옐로우',
  'ORANGE':   '오렌지',
  'PURPLE':   '퍼플',
  'LAVENDER': '라벤더',
  'CORAL':    '코랄',
  'PEACH':    '피치',
  'CREAM':    '크림',
  'SALMON':   '살몬',
  'LEMON':    '레몬',
  'LIGHT':    '라이트',
  'DARK':     '다크',
  'DEEP':     '딥',
  'HOT':      '핫',
  'SOFT':     '소프트',
  'MINI':     '미니',
  'SUPER':    '슈퍼',
  'SWEET':    '스위트',
  'MOON':     '문',
  'BELLA':    '벨라',
  'FANCY':    '팬시',
  'GIPSY':    '집시',
  'BICOLOR':  '바이컬러',
  'BLANCA':   '블랑카',
  'PLAYA':    '플라야',
  'AQUA':     '아쿠아',
  'ROYAL':    '로얄',
  'CLASSIC':  '클래식',
  'STANDARD': '스탠다드',
  'PREMIUM':  '프리미엄',
  'SPECIAL':  '스페셜',
  'EXTRA':    '엑스트라',
  'VELVET':   '벨벳',
  'CANDY':    '캔디',
  'BERRY':    '베리',
  'CHERRY':   '체리',
  'AMOR':     '아모르',
  'LIMON':    '리몬',
  'VERDE':    '베르데',
  'ROJO':     '로호',
  'BLANCO':   '블랑코',
  'PASTEL':   '파스텔',
  'MIXED':    '믹스드',
  'SUMMER':   '써머',
  'SPRING':   '스프링',
  'WINTER':   '윈터',
  'GARDEN':   '가든',
  'TROPICAL': '트로피칼',
  'AKITO':    '아키토',
  'MONDIAL':  '몬디알',
  'FREEDOM':  '프리덤',
  'EXPLORER': '익스플로러',
  'TYCOON':   '타이쿤',
  'TACAZZI':  '타카치',
  'NOCHES':   '노체스',
  'VELVET':   '벨벳',
  'MYSTERY':  '미스터리',
  'ROMANCE':  '로맨스',
  'FANTASY':  '판타지',
  'MAGIC':    '매직',
  'STAR':     '스타',
  'SUNNY':    '써니',
  'NOVA':     '노바',
  'GATE':     '게이트',
  'GOLDEN':   '골든',
  // 품종 고유명 (자동변환+검색용)
  'SAFARI':    '사파리',
  'CAROLINE':  '캐롤라인',
  'CARAMEL':   '카라멜',
  'PANTHER':   '팬서',
  'CORAL':     '코랄',
  'BLUE':      '블루',
  'GREEN':     '그린',
  'BURGUNDY':  '버건디',
  'CHAMPAGNE': '샴페인',
  'BIANCA':    '비앙카',
  'MAMBO':     '맘보',
  'SALSA':     '살사',
  'TANGO':     '탱고',
};

/**
 * 영문 ProdName → 한글 자연어명 자동 생성 제안
 * 예: "CARNATION MOON LIGHT" → "카네이션 문라이트"
 *     "HYDRANGEA WHITE"       → "수국 화이트"
 */
export function suggestDisplayName(prodName) {
  if (!prodName) return '';
  let text = prodName.trim().toUpperCase();

  // 복합어 먼저 치환
  for (const [phrase, kr] of PHRASE_MAP) {
    text = text.replace(phrase, kr);
  }

  // 토큰 단위 매핑
  const tokens = text.split(/\s+/);
  const mapped = tokens.map(token => {
    if (/[\uAC00-\uD7A3]/.test(token)) return token; // 이미 한글
    if (FLOWER_MAP[token]) return FLOWER_MAP[token];
    if (WORD_MAP[token]) return WORD_MAP[token];
    return token; // 매핑 없으면 원본 유지
  });

  return mapped.join(' ').trim();
}

/**
 * 웹 표시용 이름 반환 — DisplayName 있으면 사용, 없으면 ProdName
 */
export function getDisplayName(product) {
  return product?.DisplayName || product?.ProdName || '';
}

// ── 한글 자모 분해 (초/중/종성)
const CHOSUNG  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNGSUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONGSUNG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function decomposeHangul(text) {
  let result = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const jong = offset % 28;
      const jung = Math.floor(offset / 28) % 21;
      const cho  = Math.floor(offset / 28 / 21);
      result += CHOSUNG[cho] + JUNGSUNG[jung] + (jong ? JONGSUNG[jong] : '');
    } else {
      result += ch;
    }
  }
  return result;
}

function getChosung(text) {
  let result = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      result += CHOSUNG[Math.floor((code - 0xAC00) / 28 / 21)];
    } else if (/[ㄱ-ㅎ]/.test(ch)) {
      result += ch;
    }
  }
  return result;
}

function isPureChosung(text) {
  return /^[ㄱ-ㅎ\s]+$/.test(text.trim());
}

/**
 * 한글 자모 기반 매칭 (초성 검색 + 완전 자모 분해 검색)
 * - "ㅋㄴ이션" → true for "카네이션"
 * - "문라이" → true for "문라이트"
 */
export function jamoMatch(query, target) {
  if (!query || !target) return false;
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();

  if (t.includes(q)) return true;

  // 초성만 입력한 경우
  if (isPureChosung(q.replace(/\s/g, ''))) {
    return getChosung(t).includes(q.replace(/\s/g, ''));
  }

  // 자모 분해 후 포함 검색
  return decomposeHangul(t).includes(decomposeHangul(q));
}

/**
 * 자모 유사도 점수 (0~1) — 70% 이상이면 매칭으로 간주
 */
export function jamoSimilarity(query, target) {
  if (!query || !target) return 0;
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (t.includes(q)) return 1;
  if (jamoMatch(query, target)) return 0.85;

  const qj = decomposeHangul(q);
  const tj = decomposeHangul(t);
  const lcs = lcsLength(qj, tj);
  return lcs / Math.max(qj.length, tj.length);
}

function lcsLength(a, b) {
  if (a.length > 60 || b.length > 60) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  return dp[a.length][b.length];
}

function compactLetters(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\d+\s*(박스|단|송이|개|ea|box|bunch|stem[s]?|cm|kg|ml|팩|봉|병)/gi, ' ')
    .replace(/[()[\]{}<>~!@#$%^&*+=|\/\\:;'"`?,.\-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, '');
}

function compactCandidates(text) {
  const toks = tokenizeForMatch(text);
  const out = new Set();
  toks.forEach(t => out.add(compactLetters(t)));
  for (let size = 2; size <= 4; size++) {
    for (let i = 0; i <= toks.length - size; i++) {
      out.add(compactLetters(toks.slice(i, i + size).join('')));
      out.add(compactLetters(toks.slice(i, i + size).join(' ')));
    }
  }
  out.add(compactLetters(text));
  return [...out].filter(v => v.length >= 3);
}

function letterSimilarity(query, target) {
  const q = compactLetters(query);
  const t = compactLetters(target);
  if (!q || !t) return 0;
  if (t.includes(q) || q.includes(t)) return 1;
  const lcs = lcsLength(q, t);
  return lcs / Math.max(q.length, t.length);
}

function bestLetterSimilarity(query, prodTexts) {
  const qCandidates = compactCandidates(query);
  const tCandidates = prodTexts.flatMap(compactCandidates);
  let best = 0;
  for (const q of qCandidates) {
    for (const t of tCandidates) {
      best = Math.max(best, letterSimilarity(q, t));
      if (best === 1) return best;
    }
  }
  return best;
}

// 한글 → 영문 역방향 맵 (WORD_MAP + FLOWER_MAP + PHRASE_MAP 의 value→key)
const KO_TO_EN = {};
for (const [en, ko] of Object.entries(FLOWER_MAP)) KO_TO_EN[ko] = en;
for (const [en, ko] of Object.entries(WORD_MAP))   KO_TO_EN[ko] = en;
for (const [en, ko] of PHRASE_MAP)                 KO_TO_EN[ko.toLowerCase()] = en.toLowerCase();

/**
 * 한글 단어 → 영문 동의어 (소문자). 없으면 null.
 * 예: "캐롤라인" → null (사전에 없음), "장미" → "rose", "문라이트" → "moon light"
 */
export function getEnglishOf(koreanWord) {
  if (!koreanWord) return null;
  const k = String(koreanWord).toLowerCase().trim();
  return KO_TO_EN[k] ? KO_TO_EN[k].toLowerCase() : null;
}

/**
 * 입력 토큰화 — 괄호/특수문자 제거, 수량 토큰 제거, 2자+ 만 유지
 * paste.js 의 buildCandidates 에서 사용
 */
const STOPWORD_TOKENS = new Set([
  '박스','단','송이','개','ea','box','bunch','stem','stems','cm','kg','ml','팩','봉','병',
  '번','총','급','종','류','입','콜롬비아','colombia','중국','china','네덜란드','netherlands',
  '에콰도르','ecuador','태국','thailand','호주','australia',
]);

export function tokenizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\d+\s*(박스|단|송이|개|ea|box|bunch|stem[s]?|cm|kg|ml|팩|봉|병)/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[()[\]{}<>~!@#$%^&*+=|\/\\:;'"`?,.\-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORD_TOKENS.has(t));
}

/**
 * 종합 매칭 점수 (0~100) — 입력 토큰들이 품목의 DisplayName/ProdName/FlowerName/CounName 에
 * 얼마나 매칭되는지 계산. 토큰별 점수 누적 + 매칭 비율 보너스.
 *
 * 매칭 단계 (점수 가중치):
 *   - 정확 포함 (한글 또는 영문): 30점
 *   - 한글→영문 역변환 후 영문 ProdName 포함: 25점
 *   - 자모 분해 매칭 (한글 ↔ 한글): 20점
 *   - 자모 유사도 ≥0.7: sim × 15점
 *   - 마지막 토큰 (= 품종명 추정) 매칭 시 보너스 +20점
 *   - 모든 토큰 매칭 비율 × 50점 보너스
 */
export function scoreMatch(inputName, prod, searchQuery = '') {
  const dn = (getDisplayName(prod) || '').toLowerCase();
  const pn = (prod.ProdName || '').toLowerCase();
  const fn = (prod.FlowerName || '').toLowerCase();
  const cn = (prod.CounName || '').toLowerCase();
  const productTexts = [dn, pn, fn, cn].filter(Boolean);

  // 입력 + 검색어 통합 토큰
  const inputToks = tokenizeForMatch(inputName);
  const sqToks = tokenizeForMatch(searchQuery);
  const allTokens = [...new Set([...inputToks, ...sqToks])];
  const englishQueries = allTokens.map(getEnglishOf).filter(Boolean);
  const letterQueries = [...new Set([inputName, searchQuery, ...englishQueries].filter(Boolean))];
  const bestLetter = Math.max(0, ...letterQueries.map(q => bestLetterSimilarity(q, productTexts)));
  if (allTokens.length === 0) return bestLetter >= 0.6 ? Math.round(bestLetter * 80) : 0;

  const lastToken = inputToks[inputToks.length - 1] || sqToks[sqToks.length - 1] || '';

  let score = 0;
  let matched = 0;
  const matchedTokens = [];

  for (const tok of allTokens) {
    const isLast = tok === lastToken;
    let tokScore = 0;

    // 1. 직접 포함
    if (dn.includes(tok) || pn.includes(tok) || fn.includes(tok) || cn.includes(tok)) {
      tokScore = 30;
    } else {
      // 2. 한글→영문 역변환 후 영문 ProdName/FlowerName 검색
      const en = getEnglishOf(tok);
      if (en && (pn.includes(en) || fn.includes(en) || dn.includes(en))) {
        tokScore = 25;
      } else {
        // 3. 자모 분해 매칭 (한글)
        if (jamoMatch(tok, dn) || jamoMatch(tok, fn)) {
          tokScore = 20;
        } else {
          // 4. 자모 유사도 0.7+
          const sim = Math.max(jamoSimilarity(tok, dn), jamoSimilarity(tok, pn));
          if (sim >= 0.7) tokScore = sim * 15;
        }
      }
    }

    if (tokScore > 0) {
      // 마지막 토큰 (= 품종명 추정) 매칭 시 +20 보너스
      if (isLast) tokScore += 20;
      score += tokScore;
      matched++;
      matchedTokens.push(tok);
    }
  }

  // 매칭 비율 보너스 (모든 토큰 매칭 = +50)
  if (matched > 0) {
    score += (matched / allTokens.length) * 50;
  }
  if (bestLetter >= 0.7) {
    score = Math.max(score, bestLetter * 85);
  }

  return Math.min(100, Math.round(score));
}

/**
 * 제품 배열에서 검색어로 필터링 (DisplayName + ProdName 모두 검색, 자모 매칭 포함)
 * threshold: 0.7 = 70% 이상 유사도
 */
export function filterProducts(products, query, threshold = 0.7) {
  if (!query) return products;
  const q = query.trim();
  const ql = q.toLowerCase();
  // 한글 검색어면 영문 동의어도 같이 검색
  const enEquiv = KO_TO_EN[q] ? KO_TO_EN[q].toLowerCase() : null;
  const queryToks = tokenizeForMatch(q);
  const enQueries = [...new Set([enEquiv, ...queryToks.map(getEnglishOf)].filter(Boolean))];

  return products.filter(p => {
    const dn = getDisplayName(p);
    const dnLower = dn.toLowerCase();
    const pn = (p.ProdName || '').toLowerCase();
    const flower = (p.FlowerName || '').toLowerCase();
    const country = (p.CounName || '').toLowerCase();
    const code = (p.ProdCode || '').toLowerCase();

    // 영문 직접 포함 검색
    if (pn.includes(ql) || dnLower.includes(ql) || code.includes(ql) || flower.includes(ql) || country.includes(ql)) return true;
    // 한글→영문 역변환 후 ProdName 검색 (예: "사파리" → "safari")
    if (enQueries.some(en => pn.includes(en) || flower.includes(en) || dnLower.includes(en))) return true;
    if (bestLetterSimilarity(q, [dnLower, pn, flower, country, code]) >= threshold) return true;
    if (enQueries.some(en => bestLetterSimilarity(en, [dnLower, pn, flower, country, code]) >= threshold)) return true;
    // 자모 매칭
    if (jamoMatch(q, dn)) return true;
    if (jamoSimilarity(q, dn) >= threshold) return true;
    return false;
  });
}
