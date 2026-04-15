// lib/chat/entities.js — 텍스트에서 거래처/품목 이름 추출 헬퍼
import { query, sql } from '../db';

// ── 거래처 이름 추출: DB 기반 가장 긴 매칭
let _custCache = null;
let _custCacheAt = 0;
const CACHE_TTL_MS = 60_000; // 1분 캐시

async function getCustomers() {
  const now = Date.now();
  if (_custCache && now - _custCacheAt < CACHE_TTL_MS) return _custCache;
  const r = await query(
    `SELECT CustKey, CustName, CustArea FROM Customer WHERE ISNULL(isDeleted, 0) = 0`,
    {}
  );
  _custCache = r.recordset;
  _custCacheAt = now;
  return _custCache;
}

// ── 국가/지역 키워드 사전 (CustArea 또는 CustName 매칭)
const COUNTRY_KEYWORDS = [
  '네덜란드', '콜롬비아', '에콰도르', '케냐', '중국', '대만', '베트남',
  '일본', '말레이시아', '이스라엘', '에티오피아', '뉴질랜드', '태국',
];

export function extractCountry(text) {
  for (const kw of COUNTRY_KEYWORDS) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

export async function findCustomer(text) {
  const custs = await getCustomers();
  // 긴 이름부터 매칭 (약어 충돌 방지)
  const sorted = [...custs].sort((a, b) => (b.CustName?.length || 0) - (a.CustName?.length || 0));
  for (const c of sorted) {
    if (!c.CustName) continue;
    if (text.includes(c.CustName)) return c;
  }
  // 부분 일치 (예: "꽃길" 검색 → "꽃길"이 포함된 첫 번째)
  const tokens = text.split(/\s+/).filter(t => t.length >= 2);
  for (const tok of tokens) {
    const match = custs.find(c => c.CustName?.includes(tok));
    if (match) return match;
  }
  return null;
}

// ── 복수 후보 반환 (선택지 제시용)
// 국가 키워드 있으면: CustArea 또는 CustName 에 해당 국가명 포함된 거래처 전체
// 그 외: CustName 에 토큰 포함된 거래처 (최대 limit개)
export async function findCustomersMulti(text, limit = 10) {
  const custs = await getCustomers();
  const country = extractCountry(text);

  if (country) {
    const hits = custs.filter(c =>
      (c.CustArea && c.CustArea.includes(country)) ||
      (c.CustName && c.CustName.includes(country))
    );
    return { country, candidates: hits.slice(0, limit) };
  }

  // 정확히 포함되는 거래처 전체 수집
  const exact = custs.filter(c => c.CustName && text.includes(c.CustName));
  if (exact.length > 0) {
    return { country: null, candidates: exact.slice(0, limit) };
  }

  // 토큰 부분 일치
  const tokens = text.split(/\s+/).filter(t => t.length >= 2);
  const seen = new Set();
  const hits = [];
  for (const tok of tokens) {
    for (const c of custs) {
      if (c.CustName && c.CustName.includes(tok) && !seen.has(c.CustKey)) {
        seen.add(c.CustKey);
        hits.push(c);
        if (hits.length >= limit) break;
      }
    }
    if (hits.length >= limit) break;
  }
  return { country: null, candidates: hits };
}

// ── 품목 이름 추출: 자주 쓰이는 꽃 이름 사전 + DB 부분매칭
const FLOWER_KEYWORDS = [
  '카네이션', '루스커스', 'Ruscus', '장미', 'ROSE', '튤립', 'Tulip',
  '수국', 'Hydrangea', '알스트로', 'ALSTROMERIA', '아스틸베', 'Astilbe',
  '칼라', 'Calla', '에링지움', 'Eryngium', 'SALAL', '유칼립투스', 'Eucalyptus',
  '카라', 'CALLA', '아가판서스', 'Agapanthus', '아네모네', 'Anemone',
  '안수리움', 'Anthurium', '판쿰', 'Panicum', '스키미아', 'Skimmia',
];

export async function findProduct(text) {
  // 사전 키워드 먼저
  for (const kw of FLOWER_KEYWORDS) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      const r = await query(
        `SELECT TOP 1 ProdKey, ProdName FROM Product
          WHERE ISNULL(isDeleted, 0) = 0
            AND (ProdName LIKE @kw OR FlowerName LIKE @kw)`,
        { kw: { type: sql.NVarChar, value: `%${kw}%` } }
      );
      if (r.recordset[0]) return r.recordset[0];
    }
  }
  // 토큰 부분매칭
  const tokens = text.split(/\s+/).filter(t => t.length >= 2);
  for (const tok of tokens) {
    const r = await query(
      `SELECT TOP 1 ProdKey, ProdName FROM Product
        WHERE ISNULL(isDeleted, 0) = 0
          AND (ProdName LIKE @kw OR FlowerName LIKE @kw)`,
      { kw: { type: sql.NVarChar, value: `%${tok}%` } }
    );
    if (r.recordset[0]) return r.recordset[0];
  }
  return null;
}
