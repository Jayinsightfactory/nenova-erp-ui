// 주차별 매출이익 보고서의 품목/운송료 분류 규칙 — DB 연결 없는 순수 모듈
export const CATEGORIES = [
  { key: '콜롬비아 수국', coun: '콜롬비아', flower: /수국/ },
  { key: '콜롬비아 카네이션', coun: '콜롬비아', flower: /카네이션/ },
  { key: '콜롬비아 장미', coun: '콜롬비아', flower: /장미/ },
  { key: '콜롬비아 루스커스', coun: '콜롬비아', flower: /루스커스/ },
  { key: '콜롬비아 알스트로', coun: '콜롬비아', flower: /알스트로/ },
  { key: '네덜란드', coun: '네덜란드' },
  { key: '호주', coun: '호주' },
  { key: '태국', coun: '태국' },
  { key: '중국', coun: '중국' },
  { key: '에콰도르', coun: '에콰도르' },
  { key: '미국', coun: '미국' },
  { key: '이스라엘', coun: '이스라엘', variant: 'noEnding' },
  { key: '뉴질랜드', coun: '뉴질랜드', variant: 'noEnding' },
  { key: '일본', coun: '일본', variant: 'noEnding' },
  { key: '베트남', coun: '베트남' },
  { key: '공제', manualOnly: true },
];

export const EXTRA_CATEGORY = '기타(미분류)';

export function isNonValueWeightItem(productName) {
  return /(?:chargeable|gross)\s*weig(?:ht|th)/i.test(String(productName || ''));
}

/**
 * 운송료/SERVICE FEE/현지상차운임 같은 비재고 비용행 판정 — DB 연결 없는 순수 함수.
 *
 * CASE_CATEGORY(lib/profitReport.js)가 이 품목들을 국가/화종으로 분류하는 것은 S 포워딩·H 통관
 * 자동분류 원천으로 쓰기 위한 업무 규칙이다. 그 분류를 재고 평가(F/E)·재고단가표·매입(Q) 집계·
 * 단위혼재 검사에 그대로 적용하면 비용행 ProductStock 잔량이 상품재고로 잘못 계상된다
 * (2026-08-11: 27차 F 폭증 결함 — 네덜란드 F가 1,858,041,803원, 태국 F가 70,582,040원으로
 * 나타난 원인). 이 함수는 그 반대 조건(비용행인지)만 판정하고, 국가/화종 분류 자체는 건드리지 않는다.
 */
export function isNonInventoryCostItem(productName) {
  const product = String(productName || '');
  return /운송료/.test(product) || /현지상차\s*운임/.test(product) || /SERVICE\s*FEE/i.test(product);
}

/** 재고평가·재고단가표·상품구매(Q) 집계에서 함께 제외해야 하는 비재고 행 전체(무게 placeholder + 비용행).
 * S 포워딩/H 통관 자동분류는 이 행을 그대로 배분 대상으로 써야 하므로 이 함수를 사용하지 않는다. */
export function isNonStockableItem(productName) {
  return isNonValueWeightItem(productName) || isNonInventoryCostItem(productName);
}

export function classifyCategory(counName, flowerName, productName = '') {
  const coun = String(counName || '');
  const flower = String(flowerName || '');
  const product = String(productName || '');
  if (isNonValueWeightItem(product)) return null;
  if (/현지상차\s*운임/.test(product)) return '콜롬비아 수국';
  if (/카네이션\s*운송료/.test(product)) return '콜롬비아 카네이션';
  if (/장미\s*운송료/.test(product)) return '콜롬비아 장미';
  if (/루스커스\s*운송료/.test(product)) return '콜롬비아 루스커스';
  if (/네덜란드\s*운송료/.test(product)) return '네덜란드';
  if (/태국\s*운송료/.test(product)) return '태국';
  if (/중국\s*운송료/.test(product)) return '중국';
  for (const c of CATEGORIES) {
    if (c.manualOnly) continue;
    if (!coun.includes(c.coun)) continue;
    if (c.flower && !c.flower.test(flower)) continue;
    return c.key;
  }
  return EXTRA_CATEGORY;
}
