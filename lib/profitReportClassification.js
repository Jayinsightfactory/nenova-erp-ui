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
