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
const STOPWORDS = new Set([
  '박스','단','송이','개','ea','box','bunch','stem','stems','cm','kg','ml','팩','봉','병',
  '번','총','급','등','종','류','입',          // 학습 데이터 노이즈에 자주 나오는 단음절 단어
  'a급','b급','c급'
]);
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    // 수량 표현 제거: 숫자+단위 (5박스, 3단, 10송이, 2EA 등)
    .replace(/\d+\s*(박스|단|송이|개|ea|box|bunch|stem[s]?|cm|kg|ml|팩|봉|병)/gi, ' ')
    .replace(/\d+/g, ' ')                       // 남은 단독 숫자 제거
    .replace(/[()[\]{}]/g, ' ')                 // 괄호 제거
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')          // 특수문자 → 공백
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

// 두 토큰이 매치인지 판단 — 짧은 토큰(<4자)은 정확 일치만, 긴 토큰만 부분 일치 허용
function tokensMatch(a, b) {
  if (a === b) return true;
  // 양쪽 다 4자 이상일 때만 부분 일치 허용 (예: '핑크몬디알' ↔ '핑크' 같은 짧은-긴 매칭 차단)
  if (a.length >= 4 && b.length >= 4) {
    return a.includes(b) || b.includes(a);
  }
  return false;
}

export function findMappingFuzzy(inputName, mappings) {
  if (!inputName) return null;
  const exact = normalizeToken(inputName);
  if (mappings[exact]) return { key: exact, value: mappings[exact], score: 1, matchType: 'exact' };

  const compactExact = exact.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(mappings)) {
    const compactKey = normalizeToken(key).replace(/\s+/g, '');
    if (compactKey && compactKey === compactExact) {
      return { key, value, score: 0.98, matchType: 'compact' };
    }
  }

  const inTokens = tokenize(inputName);
  if (inTokens.length === 0) return null;

  // 후보 수집: 입력 모든 토큰이 키에 매치되는 키들
  const candidates = [];
  for (const [key, value] of Object.entries(mappings)) {
    const keyTokens = tokenize(key);
    if (keyTokens.length === 0) continue;
    const allIn = inTokens.every(t => keyTokens.some(k => tokensMatch(k, t)));
    if (allIn) {
      candidates.push({ key, value, keyLen: keyTokens.length });
    }
  }
  if (candidates.length === 0) return null;

  // 단일 후보 — 채택
  if (candidates.length === 1) {
    const c = candidates[0];
    return { key: c.key, value: c.value, score: inTokens.length / Math.max(c.keyLen, inTokens.length), matchType: 'fuzzy' };
  }

  // 다수 후보 — prodKey 통일성 검사
  // 모든 후보가 같은 prodKey 를 가리키면 (= 같은 품목의 다른 표기) 어느 것을 골라도 정답
  const allProdKeys = new Set(candidates.map(c => c.value?.prodKey));
  if (allProdKeys.size === 1) {
    candidates.sort((a, b) => Math.abs(a.keyLen - inTokens.length) - Math.abs(b.keyLen - inTokens.length));
    const c = candidates[0];
    return { key: c.key, value: c.value, score: inTokens.length / Math.max(c.keyLen, inTokens.length), matchType: 'fuzzy' };
  }

  // 다수 후보 + 다수 prodKey — 콜롬비아 우선 (사용자 운영 패턴: 미명시 입력은 대부분 콜롬비아)
  const isKolombia = (c) => /콜롬비아|colombia/i.test(c.value?.counName || '') || /콜롬비아|colombia/i.test(c.key || '');
  const colCandidates = candidates.filter(isKolombia);
  if (colCandidates.length > 0) {
    // 콜롬비아 후보 중 prodKey 통일이면 채택, 아니면 키 길이 가까운 것
    const colProdKeys = new Set(colCandidates.map(c => c.value?.prodKey));
    colCandidates.sort((a, b) => Math.abs(a.keyLen - inTokens.length) - Math.abs(b.keyLen - inTokens.length));
    const c = colCandidates[0];
    return {
      key: c.key, value: c.value,
      score: inTokens.length / Math.max(c.keyLen, inTokens.length),
      matchType: colProdKeys.size === 1 ? 'fuzzy' : 'fuzzy-default-colombia',
    };
  }

  // 콜롬비아 후보도 없음 + 입력 1토큰 → 모호
  if (inTokens.length === 1) return null;

  // 입력 ≥2 토큰: specific match 시도 (키 길이 가까운 것)
  candidates.sort((a, b) => Math.abs(a.keyLen - inTokens.length) - Math.abs(b.keyLen - inTokens.length));
  const top = candidates[0];
  const tiedTop = candidates.filter(c => Math.abs(c.keyLen - inTokens.length) === Math.abs(top.keyLen - inTokens.length));
  if (tiedTop.length > 1) {
    const tiedProdKeys = new Set(tiedTop.map(c => c.value?.prodKey));
    if (tiedProdKeys.size > 1) return null;
  }
  return { key: top.key, value: top.value, score: inTokens.length / Math.max(top.keyLen, inTokens.length), matchType: 'fuzzy' };
}

// fallback 의심 prodKey — 같은 ProdKey 로 매핑된 입력 키가 너무 많으면
// LLM 의 "추측 fallback" 일 가능성이 높음. 카네이션 Alhambra(338) 사례처럼.
// 매핑 저장 직전 호출자에게 경고를 던지기 위한 검사.
const FALLBACK_THRESHOLD = 5;  // 같은 ProdKey 가 5개 이상 키에 매핑되면 의심

export function detectFallbackProdKey(prodKey, excludeKey = null) {
  const cache = loadMappings();
  let count = 0;
  const sampleKeys = [];
  for (const [k, v] of Object.entries(cache)) {
    if (k === excludeKey) continue;
    if (v.prodKey === Number(prodKey)) {
      count++;
      if (sampleKeys.length < 3) sampleKeys.push(k);
    }
  }
  return {
    isFallback: count >= FALLBACK_THRESHOLD,
    count,
    sampleKeys,
  };
}

export function saveMapping(inputToken, prodInfo, options = {}) {
  const { force = false } = options;
  const cache = loadMappings();
  const key = normalizeToken(inputToken);
  if (!key) return { saved: false, reason: 'empty-key' };

  // fallback 의심 가드 (force=true 면 우회)
  if (!force && prodInfo?.prodKey) {
    const guard = detectFallbackProdKey(prodInfo.prodKey, key);
    if (guard.isFallback) {
      return {
        saved: false,
        reason: 'fallback-suspect',
        warning: `이 품목(${prodInfo.prodName || prodInfo.prodKey})은 이미 ${guard.count}개 입력에 매핑되어 있어 자동 추측 fallback 일 가능성이 높습니다. 정말 저장하려면 force=true 옵션 사용.`,
        sampleKeys: guard.sampleKeys,
      };
    }
  }

  cache[key] = { ...prodInfo, savedAt: new Date().toISOString() };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { saved: true, key };
  } catch (e) {
    console.error('[parseMappings] write failed:', e.message);
    return { saved: false, reason: 'write-error', error: e.message };
  }
}

export function getMapping(inputToken) {
  const cache = loadMappings();
  return cache[normalizeToken(inputToken)] || null;
}

export function normalizeToken(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(add|cancel|delete|box|bunch|stem|stems|ea)\b/gi, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/\d+(\.\d+)?\s*(박스|단|송이|개|box|bunch|stem|stems|cm|ea)?/gi, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
