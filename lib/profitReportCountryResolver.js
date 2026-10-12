// 주차별 매출이익 보고서의 국가·화종·통화·과세환율 단일 resolver.
// SQL CASE와 브라우저/서버 순수 계산이 같은 우선순위를 사용하도록 이 파일만 수정한다.

export const EXTRA_CATEGORY = '기타(미분류)';

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
  // 28차 원본의 샘플/단·샘플/송이 619,546원 행. 기존 공제 placeholder를 대체한다.
  { key: '국내', coun: '국내', flower: /왁스/, product: /샘플/ },
];

/** 22~27차 원본은 마지막 행이 공제, 28차부터는 국내다. */
export function profitReportCategoriesForWeek(majorWeek) {
  const major = Number(majorWeek);
  if (major >= 22 && major <= 27) {
    return [...CATEGORIES.slice(0, -1), { key: '공제', coun: '공제', variant: 'deduction' }];
  }
  return CATEGORIES.map(category => ({ ...category }));
}

export const CATEGORY_CURRENCY = Object.freeze({
  네덜란드: 'EUR',
  호주: 'AUD',
  중국: 'CNY',
  일본: 'JPY',
});

export const SOURCE_ENTRY_START_MAJOR = Object.freeze({
  호주: Object.freeze({ H: 28, R: 28 }),
  베트남: Object.freeze({ H: 29, R: 29 }),
});

const positive = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function isNonValueWeightItem(productName) {
  return /(?:chargeable|gross)\s*weig(?:ht|th)/i.test(String(productName || ''));
}

export function classifyProfitReportCategory({ counName, flowerName, productName } = {}) {
  const coun = String(counName || '');
  const flower = String(flowerName || '');
  const product = String(productName || '');
  if (isNonValueWeightItem(product)) return null;

  // 명시적 운송료 업무규칙이 국가/화종 placeholder보다 먼저다.
  if (/현지상차\s*운임/.test(product)) return '콜롬비아 수국';
  if (/카네이션\s*운송료/.test(product)) return '콜롬비아 카네이션';
  if (/장미\s*운송료/.test(product)) return '콜롬비아 장미';
  if (/루스커스\s*운송료/.test(product)) return '콜롬비아 루스커스';
  if (/네덜란드\s*운송료/.test(product)) return '네덜란드';
  if (/태국\s*운송료/.test(product)) return '태국';
  if (/중국\s*운송료/.test(product)) return '중국';

  // 경영지원 placeholder가 국내/왁스로 저장돼도 품명의 CHINA 단서가 화종보다 우선한다.
  if (/CHINA|중국/i.test(product)) return '중국';
  if (coun.includes('국내') && flower.includes('왁스') && /샘플/.test(product)) return '국내';

  // 기존 국내 수국 운송 placeholder 예외.
  if (coun.includes('국내') && /수국|HYDRANGEA/i.test(product)) return '콜롬비아 수국';
  for (const category of CATEGORIES) {
    if (!coun.includes(category.coun)) continue;
    if (category.flower && !category.flower.test(flower)) continue;
    if (category.product && !category.product.test(product)) continue;
    return category.key;
  }
  return EXTRA_CATEGORY;
}

export function classifyCategory(counName, flowerName, productName = '') {
  return classifyProfitReportCategory({ counName, flowerName, productName });
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

export function sourceEntryStartMajor(category, column) {
  return SOURCE_ENTRY_START_MAJOR[category]?.[column] ?? null;
}

export function canCarryPreviousTaxableRate(category, currentMajor, { sameOrderYear = true } = {}) {
  const major = Number(currentMajor);
  if (!sameOrderYear || !Number.isInteger(major) || major <= 1 || major < 29) return false;
  const start = sourceEntryStartMajor(category, 'R');
  return start == null || major - 1 >= start;
}

/**
 * R 선택 우선순위: 현재 수기 > 당주 BILL > 허용된 전차수 확정 R > CurrencyMaster.
 * autoRate는 수기값을 제외한 자동값이고 effectiveRate는 실제 계산값이다.
 */
export function resolveProfitReportRate({
  category,
  currentMajor,
  manualRate,
  invoiceRate,
  previousConfirmedRate,
  currencyMasterRate,
  sameOrderYear = true,
} = {}) {
  const currencyCode = currencyCodeForCategory(category);
  if (!currencyCode) return {
    currencyCode: null, manualRate: null, autoRate: null, effectiveRate: null,
    autoSource: 'not_applicable', source: 'not_applicable', previousCarryAllowed: false,
  };
  const manual = positive(manualRate);
  const invoice = positive(invoiceRate);
  const previousCarryAllowed = canCarryPreviousTaxableRate(category, currentMajor, { sameOrderYear });
  const previous = previousCarryAllowed ? positive(previousConfirmedRate) : null;
  const master = positive(currencyMasterRate);
  const autoRate = invoice ?? previous ?? master;
  const autoSource = invoice != null
    ? 'freight_cost_snapshot'
    : previous != null
      ? 'previous_report_taxable_rate'
      : master != null
        ? 'currency_master_fallback'
        : 'missing';
  return {
    currencyCode,
    manualRate: manual,
    autoRate,
    effectiveRate: manual ?? autoRate,
    autoSource,
    source: manual != null ? 'manual_invoice' : autoSource,
    previousCarryAllowed,
  };
}
