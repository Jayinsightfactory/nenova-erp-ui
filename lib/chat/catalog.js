// lib/chat/catalog.js — DB 엔티티 카탈로그 (챗봇 디스앰비기에이션용)
//
// 목적:
//   "네덜란드" 같은 토큰이 들어왔을 때 어떤 의미인지 DB 기반으로 판별:
//     - 거래처 이름 (Customer.CustName 포함)
//     - 거래처 지역 (Customer.CustArea)
//     - 꽃 원산지 국가 (Product.CounName)
//     - 꽃 종류 (Product.FlowerName)
//
// 외부 API 호출 없음. SQL 학습만.
// 캐시 TTL 10분.

import { query } from '../db';

const CATALOG_TTL_MS = 10 * 60 * 1000;
let _catalog = null;
let _catalogAt = 0;
let _building = null;

async function buildCatalog() {
  // Customer — 이름·지역
  const custQ = await query(
    `SELECT CustKey, CustName, CustArea
       FROM Customer WHERE ISNULL(isDeleted,0)=0`
  );
  // Product — 원산지·꽃이름 (DISTINCT)
  const counQ = await query(
    `SELECT CounName, COUNT(*) AS Cnt
       FROM Product WHERE ISNULL(isDeleted,0)=0 AND CounName IS NOT NULL AND CounName<>''
       GROUP BY CounName`
  );
  const flwrQ = await query(
    `SELECT FlowerName, COUNT(*) AS Cnt
       FROM Product WHERE ISNULL(isDeleted,0)=0 AND FlowerName IS NOT NULL AND FlowerName<>''
       GROUP BY FlowerName`
  );

  const customers = custQ.recordset;
  const countries = counQ.recordset.map(r => ({ name: r.CounName, count: r.Cnt }));
  const flowers   = flwrQ.recordset.map(r => ({ name: r.FlowerName, count: r.Cnt }));

  // 거래처 지역 (DISTINCT)
  const areaSet = new Set();
  for (const c of customers) if (c.CustArea) areaSet.add(c.CustArea);
  const areas = [...areaSet];

  return {
    customers,        // [{ CustKey, CustName, CustArea }]
    countries,        // [{ name, count }] — Product.CounName
    flowers,          // [{ name, count }] — Product.FlowerName
    areas,            // ['서울','경기',...] — Customer.CustArea distinct
    builtAt: new Date().toISOString(),
    sizes: {
      customers: customers.length,
      countries: countries.length,
      flowers:   flowers.length,
      areas:     areas.length,
    },
  };
}

export async function getCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && _catalog && now - _catalogAt < CATALOG_TTL_MS) return _catalog;
  // 동시 빌드 방지
  if (_building) return _building;
  _building = (async () => {
    try {
      _catalog = await buildCatalog();
      _catalogAt = Date.now();
      return _catalog;
    } finally {
      _building = null;
    }
  })();
  return _building;
}

// ── 토큰 디스앰비기에이션
// 입력: 사용자 메시지 전체 텍스트 (또는 단일 토큰)
// 출력: 매칭된 의미별 후보들
//   {
//     token: '네덜란드',
//     asCustomerName: [...],   // CustName 포함 거래처
//     asCustomerArea: [...],   // CustArea 일치하는 거래처
//     asProductCountry: { name, productCount } | null,
//     asProductFlower:  { name, productCount } | null,
//     ambiguityCount: N        // 0=없음, 1=명확, 2+=모호
//   }
export async function disambiguateToken(token) {
  const cat = await getCatalog();
  const t = (token || '').trim();
  if (!t) return null;

  const asCustomerName = cat.customers.filter(c => c.CustName && c.CustName.includes(t));
  const asCustomerArea = cat.customers.filter(c => c.CustArea && c.CustArea === t);
  const country = cat.countries.find(c => c.name === t);
  const flower  = cat.flowers.find(f => f.name === t);

  let ambiguityCount = 0;
  if (asCustomerName.length > 0) ambiguityCount++;
  if (asCustomerArea.length > 0 && asCustomerName.length === 0) ambiguityCount++; // area는 name과 별도
  if (country) ambiguityCount++;
  if (flower)  ambiguityCount++;

  return {
    token: t,
    asCustomerName,
    asCustomerArea,
    asProductCountry: country ? { name: country.name, productCount: country.count } : null,
    asProductFlower:  flower  ? { name: flower.name,  productCount: flower.count  } : null,
    ambiguityCount,
  };
}

// ── 메시지에서 의미 모호 후보 토큰들 추출
// 사용자 메시지를 공백/조사 분리 후, 각 토큰을 disambiguateToken 으로 평가.
// 의미가 1+ 이상 매칭되는 토큰만 반환.
export async function findAmbiguousTokens(text) {
  await getCatalog();
  // 한국어 조사 제거 (간단)
  const cleaned = text
    .replace(/[\s,.\u3001\u3002\u00b7]+/g, ' ')
    .replace(/(을|를|이|가|은|는|에서|에게|의|와|과|도|만|로|으로|에)\b/g, ' ');
  const tokens = cleaned.split(' ').filter(t => t.length >= 2);

  const seen = new Set();
  const results = [];
  for (const tok of tokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    const d = await disambiguateToken(tok);
    if (d && (d.asCustomerName.length || d.asCustomerArea.length || d.asProductCountry || d.asProductFlower)) {
      results.push(d);
    }
  }
  return results;
}
