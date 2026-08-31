import { EXTRA_CATEGORY, profitReportCategoriesForWeek } from './profitReportClassification.js';

const COUNTRY_ONLY = new Set(['네덜란드', '호주', '태국', '중국', '에콰도르', '미국', '이스라엘', '뉴질랜드', '일본', '베트남']);
const COLOMBIA_FLOWER = Object.freeze({
  '콜롬비아 수국': '수국',
  '콜롬비아 카네이션': '카네이션',
  '콜롬비아 장미': '장미',
  '콜롬비아 루스커스': '루스커스',
  '콜롬비아 알스트로': '알스트로',
});

export function allowedProfitClassificationTargets(major) {
  return profitReportCategoriesForWeek(major)
    .filter(item => !item.manualOnly && item.key !== EXTRA_CATEGORY)
    .map(item => item.key);
}

export function masterPatchForProfitCategory(category, currentFlower = '') {
  if (COLOMBIA_FLOWER[category]) return { counName: '콜롬비아', flowerName: COLOMBIA_FLOWER[category] };
  if (COUNTRY_ONLY.has(category)) return { counName: category, flowerName: String(currentFlower || '') };
  if (category === '국내') return { counName: '국내', flowerName: '왁스' };
  const error = new Error('선택한 분류는 품목마스터에 적용할 수 없습니다.');
  error.code = 'INVALID_PROFIT_CATEGORY';
  error.statusCode = 400;
  throw error;
}
