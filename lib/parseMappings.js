// lib/parseMappings.js
// 붙여넣기 주문 파싱 매핑 캐시 (서버 공유)
// inputToken → { prodKey, prodName, displayName, flowerName, counName, savedAt }

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'order-mappings.json');

// 메모리 캐시
let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadMappings(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      _cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }
  return _cache;
}

// 매핑 키 부분 매칭 — inputName 의 모든 의미있는 토큰이 키 안에 포함되면 매치
//   예: inputName='수국 화이트' → 키 '콜롬비아 수국 화이트' 매치
//       inputName='장미 핑크 5박스' → '5박스' 같은 수량 토큰은 무시
// 단어 길이 2자+ 인 토큰만 사용. 점수 = 매치된 토큰 비율(가장 많이 일치한 키 채택)
const STOPWORDS = new Set(['박스','단','송이','개','ea','box','bunch','stem','stems','kg','ml','팩','봉','병']);
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    // 수량 표현 제거: 숫자+단위 (5박스, 3단, 10송이, 2EA 등)
    .replace(/\d+\s*(박스|단|송이|개|ea|box|bunch|stem[s]?|kg|ml|팩|봉|병)/gi, ' ')
    .replace(/\d+/g, ' ')                       // 남은 단독 숫자 제거
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')          // 특수문자 → 공백
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

export function findMappingFuzzy(inputName, mappings) {
  if (!inputName) return null;
  const exact = normalizeToken(inputName);
  if (mappings[exact]) return { key: exact, value: mappings[exact], score: 1, matchType: 'exact' };

  const inTokens = tokenize(inputName);
  if (inTokens.length === 0) return null;

  // 후보 수집: 입력 모든 토큰이 키에 포함되는 키들
  const candidates = [];
  for (const [key, value] of Object.entries(mappings)) {
    const keyTokens = tokenize(key);
    if (keyTokens.length === 0) continue;
    const allIn = inTokens.every(t => keyTokens.some(k => k === t || k.includes(t) || t.includes(k)));
    if (allIn) {
      candidates.push({ key, value, keyLen: keyTokens.length });
    }
  }
  if (candidates.length === 0) return null;

  // 모호성 차단: 입력이 단일 짧은 토큰이고 후보가 여러 개면 → 매치 거절 (사용자 재학습 필요)
  if (candidates.length > 1 && inTokens.length === 1 && inTokens[0].length < 4) return null;

  // 단일 후보면 즉시 채택
  if (candidates.length === 1) {
    const c = candidates[0];
    return { key: c.key, value: c.value, score: inTokens.length / Math.max(c.keyLen, inTokens.length), matchType: 'fuzzy' };
  }

  // 다수 후보: 키 토큰 수가 입력과 가장 가까운 것 우선 (specific match)
  candidates.sort((a, b) => Math.abs(a.keyLen - inTokens.length) - Math.abs(b.keyLen - inTokens.length));
  const c = candidates[0];
  return { key: c.key, value: c.value, score: inTokens.length / Math.max(c.keyLen, inTokens.length), matchType: 'fuzzy' };
}

export function saveMapping(inputToken, prodInfo) {
  const cache = loadMappings();
  const key = normalizeToken(inputToken);
  if (!key) return;
  cache[key] = { ...prodInfo, savedAt: new Date().toISOString() };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[parseMappings] write failed:', e.message);
  }
}

export function getMapping(inputToken) {
  const cache = loadMappings();
  return cache[normalizeToken(inputToken)] || null;
}

export function normalizeToken(t) {
  return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
