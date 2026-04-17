// lib/displayName.js — 품목 자연어 표시명 유틸리티
// DB의 ProdName(영문 코드)을 한글 자연어명(DisplayName)으로 변환/매칭

// ── 복합어 먼저 (단어 단위 치환보다 우선)
const PHRASE_MAP = [
  ['PLAYA BLANCA',  '플라야블랑카'],
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

// 한글 → 영문 역방향 맵 (WORD_MAP + FLOWER_MAP 의 value→key)
const KO_TO_EN = {};
for (const [en, ko] of Object.entries(FLOWER_MAP)) KO_TO_EN[ko] = en;
for (const [en, ko] of Object.entries(WORD_MAP))   KO_TO_EN[ko] = en;

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
    if (enEquiv && (pn.includes(enEquiv) || flower.includes(enEquiv))) return true;
    // 자모 매칭
    if (jamoMatch(q, dn)) return true;
    if (jamoSimilarity(q, dn) >= threshold) return true;
    return false;
  });
}
