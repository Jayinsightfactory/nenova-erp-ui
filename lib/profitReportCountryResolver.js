// 주차별 매출이익 보고서의 SQL/JS 국가 분류 resolver.
// 최신 master의 비재고 비용행 판정은 profitReportClassification.js에 보존하고,
// 이 모듈은 SQL CASE와 주차별 역사 행을 같은 순수 규칙에 연결한다.
import {
  CATEGORIES,
  EXTRA_CATEGORY,
  classifyCategory,
  isNonValueWeightItem,
  profitReportCategoriesForWeek,
} from './profitReportClassification.js';

export { CATEGORIES, EXTRA_CATEGORY, classifyCategory, isNonValueWeightItem, profitReportCategoriesForWeek };

export const CATEGORY_CURRENCY = Object.freeze({
  네덜란드: 'EUR',
  호주: 'AUD',
  중국: 'CNY',
  일본: 'JPY',
});

export function classifyProfitReportCategory({ counName, flowerName, productName } = {}) {
  return classifyCategory(counName, flowerName, productName);
}

function sqlText(alias, column) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`허용되지 않은 SQL alias: ${alias}`);
  return `ISNULL(${alias}.${column},N'')`;
}

/** Product alias를 받는 보고서 분류 CASE. 모든 조회 SQL은 이 생성기를 공유한다. */
export function buildProfitReportCategorySql(alias = 'p') {
  const product = sqlText(alias, 'ProdName');
  const country = sqlText(alias, 'CounName');
  const flower = sqlText(alias, 'FlowerName');
  return `
  CASE
    WHEN ${product} LIKE N'%현지상차운임%' OR ${product} LIKE N'%현지상차 운임%' THEN N'콜롬비아 수국'
    WHEN ${product} LIKE N'%카네이션 운송료%' THEN N'콜롬비아 카네이션'
    WHEN ${product} LIKE N'%장미 운송료%' THEN N'콜롬비아 장미'
    WHEN ${product} LIKE N'%루스커스 운송료%' THEN N'콜롬비아 루스커스'
    WHEN ${product} LIKE N'%네덜란드 운송료%' THEN N'네덜란드'
    WHEN ${product} LIKE N'%태국 운송료%' THEN N'태국'
    WHEN ${product} LIKE N'%중국 운송료%' THEN N'중국'
    WHEN UPPER(${product}) LIKE N'%CHINA%' OR ${product} LIKE N'%중국%' THEN N'중국'
    WHEN ${country} LIKE N'%국내%' AND ${flower} LIKE N'%왁스%' AND ${product} LIKE N'%샘플%' THEN N'국내'
    WHEN ${country} LIKE N'%국내%' AND (${product} LIKE N'%수국%' OR UPPER(${product}) LIKE N'%HYDRANGEA%') THEN N'콜롬비아 수국'
    WHEN ${country} LIKE N'%콜롬비아%' AND ${flower} LIKE N'%수국%' THEN N'콜롬비아 수국'
    WHEN ${country} LIKE N'%콜롬비아%' AND ${flower} LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ${country} LIKE N'%콜롬비아%' AND ${flower} LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ${country} LIKE N'%콜롬비아%' AND ${flower} LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    WHEN ${country} LIKE N'%콜롬비아%' AND ${flower} LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ${country} LIKE N'%네덜란드%' THEN N'네덜란드'
    WHEN ${country} LIKE N'%호주%' THEN N'호주'
    WHEN ${country} LIKE N'%태국%' THEN N'태국'
    WHEN ${country} LIKE N'%중국%' THEN N'중국'
    WHEN ${country} LIKE N'%에콰도르%' THEN N'에콰도르'
    WHEN ${country} LIKE N'%미국%' THEN N'미국'
    WHEN ${country} LIKE N'%이스라엘%' THEN N'이스라엘'
    WHEN ${country} LIKE N'%뉴질랜드%' THEN N'뉴질랜드'
    WHEN ${country} LIKE N'%일본%' THEN N'일본'
    WHEN ${country} LIKE N'%베트남%' THEN N'베트남'
    ELSE N'${EXTRA_CATEGORY}'
  END`;
}

export function currencyCodeForCategory(category) {
  if (category === '국내' || category === '공제' || category === EXTRA_CATEGORY) return null;
  return CATEGORY_CURRENCY[category] || 'USD';
}
