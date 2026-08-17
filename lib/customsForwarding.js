// 그외통관비(H) + 포워딩(S) — "매출원가 양식.xlsx" 그외통관비/포워딩/콜롬비아 1차·2차 시트 재현.
// 2026-07-10 완성본(22차/23차/26차) 실셀 역분석 결과, H의 관세·선율·방역 등 잔여비용은 웹 입력값을
// 사용하되, 28차 이후 입고관리의 국가별 Gross/Chargeable weight는 자동으로 병합한다.
//
// 포워딩(S)은 재발견(2026-07-10): WarehouseDetail 에 ProdName='운송료'|'SERVICE FEE' 라인으로 이미 입고관리에
// 들어가 있음(농장 인보이스에 운송료가 한 줄로 섞인 경우도, 인보이스 자체가 순수 운송료(FREIGHTWISE AWB류)인
// 경우도 전부 이 이름으로 저장됨). WarehouseMaster.FarmName 에 'FREIGHTWISE'(콜롬비아)/'Freightwise Ecuador'
// (에콰도르)/'EXCEL'(태국) 이 그대로 저장되어 있고, InvoiceNo 에 '콜수국'/'콜카장'으로 수국·나머지4품목 구분까지
// 있음. 네덜란드/중국은 FarmName이 실제 농장명(Holex/Yunnan Melody 등, 매주 바뀔 수 있음)이라 국가패턴 매칭이
// 안 되므로, 같은 BILL(WarehouseKey) 안의 다른(비운송료) 라인의 Product.CounName 으로 역추정(2단계 판별,
// autoForwardingByCountry). 22~26차 6개 반차수 54건 실측 대조 결과 미분류 0건 — 자동집계가 오히려 엑셀보다
// 정확함(엑셀은 Cloudland 등 추가 농장이나 소액 임베디드 라인을 누락한 사례 발견). 통화(EUR=네덜란드,
// CNY=중국, 나머지 USD)는 profitReport.js 의 CATEGORY_CURRENCY/CurrencyMaster 환율 로직을 그대로 재사용.
//
// 구조:
// - 국가별(콜롬비아 수국 포함 11개 카테고리): 백상창고료(GW×단가)+관세(리터럴)+선율(리터럴)+월드운송료(GW 등급×단가)+한국방역(리터럴)
//   = 그외통관비 총액. 월드운송료는 입고 GW가 있으면 매출원가 양식의 1t/2.5t/5t 등급공식을 적용하고, 사용자가 저장한 금액이 있으면
//   그 명시적 수기값을 우선한다. VAT 처리는 엑셀 그대로 혼합
//   (백상·관세는 그대로, 선율·월드운송료·한국방역은 ÷1.1). 단, 베트남 선율은 엑셀 22/24/26차처럼
//   공급가 리터럴이므로 ÷1.1 하지 않는다.
// - 콜롬비아 4품목(카네이션·장미·알스트로·루스커스)은 반차수(세부차수) 단위로 그 4품목 합산 BILL의
//   그외통관비 TOTAL을 계산한 뒤 카테고리별 "박스당무게×박스수량" 비율로 배분 — 항상 무게비율(GW/CW 무관, 엑셀 원본).
// - 포워딩(S)도 같은 반차수 무게배분표를 공유: 콜롬비아 나머지4품목 반차수 운송료 총액(자동감지, 수기 override 가능)
//   × 배분비율 — 단, 포워딩만 GW≈CW면 무게비율, 아니면 CBM비율(박스당CBM×박스수량)로 전환(엑셀 F21 IF문 그대로).
//   그외통관비는 전환 없음. 콜롬비아 수국·네덜란드·중국·에콰도르·태국은 국가별 자동감지 합계(수기 override 가능).
import { query, sql, withTransaction } from './db.js';
import { isFreightItem, isGrossWeightItem, isChargeableWeightItem, freightWeightOfRow } from './freightCalc.js';
import { deriveTruckPlan, deriveColombiaTruckAllocation, hasExplicitTruckCounts, TRUCK_TYPES } from './colombiaTruck.js';
import { COUNTRY_SPLIT_GROUPS, COUNTRY_INPUT_FIELDS, VAT_FACTOR, vatInclusiveToNet, vatNetToInclusive } from './customsFields.js';
import { baseCountry, countryToCurrency } from './countryClassification.js';
import { classifyCategory, EXTRA_CATEGORY, isNonInventoryCostItem, isNonValueWeightItem } from './profitReportClassification.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import {
  HISTORICAL_CUSTOMS_YEAR, HISTORICAL_CUSTOMS_SOURCE,
  getHistoricalCountryCustomsRow, getHistoricalColombiaWeekly,
} from './profitReportHistoricalCustoms.js';
import {
  COLOMBIA_ALLOC_CATEGORIES, effectiveRatesForWeek,
  computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaRatios,
  computeColombiaAllocation, computeColombiaAllocationFromTotal,
} from './customsForwardingCalc.js';

export { deriveTruckPlan, deriveColombiaTruckAllocation, truckPlanAmount, hasExplicitTruckCounts, TRUCK_TYPES } from './colombiaTruck.js';
export { COUNTRY_SPLIT_GROUPS, COUNTRY_INPUT_FIELDS, VAT_FACTOR, vatInclusiveToNet, vatNetToInclusive } from './customsFields.js';
// 그외통관비/콜롬비아 배분 순수 계산식 단일 진실 소스(DB 의존 없음) — 클라이언트(그외통관비 입력화면
// 수기 편집 중 미리보기)와 서버(실계산) 양쪽이 이 재노출 하나만 쓴다(2026-08-12 결함수정).
export {
  COLOMBIA_ALLOC_CATEGORIES, effectiveRatesForWeek,
  computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaRatios,
  computeColombiaAllocation, computeColombiaAllocationFromTotal,
} from './customsForwardingCalc.js';
// 국가 키/한·영 매칭 토큰의 단일 진실 소스 — profitReport.js CASE_CATEGORY 와 카테고리 키를 맞추는
// PROFIT_REPORT_CATEGORY_KEYS 도 여기서 나온다(2026-08-11 결함수정 2).
export { baseCountry } from './countryClassification.js';
// 콜롬비아 4품목 분류 단일 진실 소스(2026-08-12 결함수정) — CASE_COLOMBIA_ALLOC(SQL, 아래)와 같은
// 한/영 토큰을 쓴다. JS 경로(예: 화면 미리보기)에서 필요하면 이 re-export를 사용한다.
export { classifyColombiaAllocCategory, COLOMBIA_ALLOC_TOKEN_MAP } from './colombiaFlowerClassification.js';
// 2026 22~27차 원본 엑셀 historical snapshot(그외통관비 **구성요소**) 단일 진실 소스 —
// 프로덕션/화면(customs-clearance API)이 함께 재사용한다. 테스트 fixture는 참조하지 않는다.
export {
  HISTORICAL_CUSTOMS_YEAR, HISTORICAL_CUSTOMS_SOURCE,
  getHistoricalCountryCustomsRow, getHistoricalColombiaWeekly, getHistoricalTaxableRate,
} from './profitReportHistoricalCustoms.js';

export const COUNTRY_CATEGORIES = [
  '콜롬비아 수국', '네덜란드', '태국', '호주', '미국', '중국',
  '에콰도르', '이스라엘', '뉴질랜드', '일본', '베트남',
];
const COUNTRY_STORAGE_FIELDS = [
  'GW1', 'GW2', 'Customs1', 'Customs2', 'SunYul1', 'SunYul2',
  'WorldFreight1', 'WorldFreight2', 'Quarantine1', 'Quarantine2',
  'WorldFreight1Manual', 'WorldFreight2Manual',
  // 저장 시점의 유효 백상 창고료 요율 스냅샷 — 나중에 전역 단가표(BakSangRate)가 바뀌어도
  // 이미 저장된 과거 행의 계산은 그대로 보존한다("글로벌 rate가 과거를 오염" 결함 수정).
  'BakSangRateApplied',
  ...COUNTRY_SPLIT_GROUPS.flatMap((g) => g.parts),
];
const WORLD_FREIGHT_MANUAL_FIELDS = {
  WorldFreight1: 'WorldFreight1Manual',
  WorldFreight2: 'WorldFreight2Manual',
};
// 콜롬비아 4품목 — 무게배분 대상 (엑셀 콜롬비아1차/2차 시트 순서: 장미/카네이션/알스트로/루스커스).
// 카테고리 키 목록 자체는 lib/customsForwardingCalc.js(→ colombiaFlowerClassification.js)가 단일
// 진실 소스이며 위 import/export로 재노출한다(중복 리터럴 제거, 2026-08-12).
// 포워딩 국가별 직접입력 대상 (콜롬비아 4품목은 별도 반차수 테이블에서 배분 계산)
export const FORWARDING_DIRECT_CATEGORIES = ['네덜란드', '중국', '콜롬비아 수국', '에콰도르', '태국'];
export const FORWARDING_STRICT_START_MAJOR = 29;

const normalizeForwardingText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeForwardingToken = (value) => normalizeForwardingText(value).toLowerCase().replace(/\s+/g, '');
const normalizeForwardingAwb = (value) => normalizeForwardingToken(value).replace(/-/g, '');
const isColombiaAllocatedCategory = (category) => COLOMBIA_ALLOC_CATEGORIES.includes(category);

/** 금액이 있는 포워딩 원천행. Gross/Chargeable weight는 무게행이므로 반드시 제외한다. */
export function isForwardingValueItem(productName) {
  const name = normalizeForwardingText(productName);
  if (!name || isGrossWeightItem(name) || isChargeableWeightItem(name) || isNonValueWeightItem(name)) return false;
  return isFreightItem(name)
    || isNonInventoryCostItem(name);
}

/** 품목명 자체가 국가·화종을 명시하면 BILL/AWB 추정보다 항상 우선한다. */
export function explicitForwardingCategory(productName) {
  const name = normalizeForwardingText(productName);
  if (!name) return null;
  const category = classifyCategory('', '', name);
  return category && category !== EXTRA_CATEGORY && category !== '국내' ? category : null;
}

function resolveForwardingCategorySet(categories) {
  const values = [...new Set([...(categories || [])].filter((value) => value && value !== EXTRA_CATEGORY && value !== '국내'))];
  if (values.length === 1) return values[0];
  if (values.length > 1 && values.every(isColombiaAllocatedCategory)) return '콜롬비아 4품목';
  return null;
}

function inferForwardingCategoryFromText(row, contextCategories = new Set()) {
  const farm = normalizeForwardingText(row.FarmName ?? row.farm);
  const invoice = normalizeForwardingText(row.InvoiceNo ?? row.inv);
  const product = normalizeForwardingText(row.ProdName ?? row.prodName);
  const text = `${product} ${invoice} ${farm}`;
  const token = normalizeForwardingToken(text);
  const context = resolveForwardingCategorySet(contextCategories);
  const knownCountry = baseCountry(row.CounName ?? row.counName)
    || baseCountry(invoice)
    || baseCountry(farm);

  if (knownCountry === '콜롬비아') {
    if (/수국|hydrangea/i.test(text)) return '콜롬비아 수국';
    return context === '콜롬비아 수국' ? context : '콜롬비아 4품목';
  }
  if (knownCountry && COUNTRY_CATEGORIES.includes(knownCountry)) return knownCountry;
  if (/freightwiseecuador|에콰도르|ecuador/.test(token)) return '에콰도르';
  if (/콜수국|hydrangea/.test(token) && /freightwise|apollo/.test(token)) return '콜롬비아 수국';
  if (/콜카장/.test(token) || (/freightwise|apollo/.test(token) && !/수국|hydrangea/.test(token))) return '콜롬비아 4품목';
  if (/holex|ezflower/.test(token)) return '네덜란드';
  if (/^excel|태국|thailand/.test(token)) return '태국';
  if (/cloudland|yunnan|중국|china/.test(token)) return '중국';
  return context;
}

const compactForwardingRow = (row, extra = {}) => ({
  orderYear: String(row.OrderYear ?? row.orderYear ?? ''),
  orderWeek: String(row.OrderWeek ?? row.orderWeek ?? ''),
  warehouseKey: row.WarehouseKey ?? row.warehouseKey ?? null,
  warehouseDetailKey: row.WarehouseDetailKey ?? row.warehouseDetailKey ?? null,
  awb: normalizeForwardingText(row.OrderNo ?? row.AWB ?? row.awb),
  invoiceNo: normalizeForwardingText(row.InvoiceNo ?? row.inv),
  farmName: normalizeForwardingText(row.FarmName ?? row.farm),
  prodKey: row.ProdKey ?? row.prodKey ?? null,
  prodName: normalizeForwardingText(row.ProdName ?? row.prodName),
  amount: Number(row.TPrice ?? row.amount ?? 0) || 0,
  ...extra,
});

const hasForwardingPurchaseActivity = (row) => [
  row.TPrice ?? row.amount,
  row.OutQuantity ?? row.outQuantity,
  row.BoxQuantity ?? row.boxQuantity,
  row.BunchQuantity ?? row.bunchQuantity,
  row.SteamQuantity ?? row.steamQuantity,
].some((value) => Math.abs(Number(value || 0)) > 0.000001);

/**
 * 입고원장의 포워딩 가치행을 한 행도 버리지 않고 분류·대조한다.
 * global raw 합계는 통화가 섞일 수 있으므로 완전성 판정은 행 수/미분류와 통화별 합계로 수행한다.
 */
export function buildForwardingLedger(rows = [], options = {}) {
  const major = Number(options.major);
  const strict = Number.isFinite(major) && major >= FORWARDING_STRICT_START_MAJOR;
  const contextsByWarehouse = new Map();
  const contextsByAwb = new Map();
  const expectedByWeek = new Map();
  const matchedByWeek = new Map();
  const matchedCategories = new Set();

  const addContext = (map, key, category) => {
    const normalized = String(key || '');
    if (!normalized || !category || category === EXTRA_CATEGORY || category === '국내') return;
    const current = map.get(normalized) || new Set();
    current.add(category);
    map.set(normalized, current);
  };

  for (const row of rows) {
    const productName = row.ProdName ?? row.prodName;
    if (isForwardingValueItem(productName) || isNonValueWeightItem(productName)) continue;
    // 입고 원장에는 금액·수량이 모두 0인 빈 상세행이 남을 수 있다. 이 행을 구매 범위로 잡으면
    // 존재하지 않아야 할 항공료까지 누락으로 오판하므로 실제 활동이 있는 행만 기대 범위로 삼는다.
    if (!hasForwardingPurchaseActivity(row)) continue;
    const category = classifyCategory(row.CounName ?? row.counName, row.FlowerName ?? row.flowerName, productName);
    if (!category || category === EXTRA_CATEGORY || category === '국내') continue;
    const week = String(row.OrderWeek ?? row.orderWeek ?? '');
    const warehouseKey = String(row.WarehouseKey ?? row.warehouseKey ?? '');
    const awb = normalizeForwardingAwb(row.OrderNo ?? row.AWB ?? row.awb);
    addContext(contextsByWarehouse, warehouseKey, category);
    addContext(contextsByAwb, awb, category);
    addContext(expectedByWeek, week, category);
  }

  const direct = {};
  const colombiaRest = {};
  const classifiedRows = [];
  const unmatchedRows = [];
  const zeroValueRows = [];
  const sourceRows = [];
  const totalsByCurrency = {};
  const addCurrency = (currency, field, amount) => {
    const code = currency || 'UNKNOWN';
    const item = totalsByCurrency[code] || { source: 0, classified: 0, unmatched: 0, delta: 0 };
    item[field] += amount;
    totalsByCurrency[code] = item;
  };

  for (const row of rows) {
    const productName = row.ProdName ?? row.prodName;
    if (!isForwardingValueItem(productName)) continue;
    const compact = compactForwardingRow(row);
    const amount = compact.amount;
    sourceRows.push(compact);
    if (Math.abs(amount) <= 0.000001) zeroValueRows.push(compact);

    const warehouseKey = String(row.WarehouseKey ?? row.warehouseKey ?? '');
    const awb = normalizeForwardingAwb(row.OrderNo ?? row.AWB ?? row.awb);
    const ownContext = contextsByWarehouse.get(warehouseKey) || new Set();
    const awbContext = contextsByAwb.get(awb) || new Set();
    const explicit = explicitForwardingCategory(productName);
    const ownCategory = resolveForwardingCategorySet(ownContext);
    const awbCategory = resolveForwardingCategorySet(awbContext);
    const category = explicit
      || ownCategory
      || awbCategory
      || inferForwardingCategoryFromText(row, new Set([...ownContext, ...awbContext]));
    const reason = explicit ? 'product_explicit'
      : ownCategory ? 'same_bill'
        : awbCategory ? 'same_awb'
          : category ? 'farm_invoice_fallback' : 'unmatched';

    if (!category || category === EXTRA_CATEGORY || category === '국내') {
      const unresolved = { ...compact, reason };
      unmatchedRows.push(unresolved);
      const unresolvedCountry = baseCountry(row.CounName ?? row.counName);
      const unresolvedCurrency = unresolvedCountry ? countryToCurrency(unresolvedCountry) : 'UNKNOWN';
      addCurrency(unresolvedCurrency, 'source', amount);
      addCurrency(unresolvedCurrency, 'unmatched', amount);
      continue;
    }

    const currency = category.startsWith('콜롬비아') ? 'USD' : countryToCurrency(category);
    addCurrency(currency, 'source', amount);
    addCurrency(currency, 'classified', amount);
    const week = compact.orderWeek;
    const matched = matchedByWeek.get(week) || new Set();
    matched.add(category);
    matchedByWeek.set(week, matched);
    matchedCategories.add(category);
    if (category === '콜롬비아 4품목') colombiaRest[week] = (colombiaRest[week] || 0) + amount;
    else direct[category] = (direct[category] || 0) + amount;
    classifiedRows.push({ ...compact, category, currency, reason });
  }

  const missingExpectedScopes = [];
  const coverageByCategory = {};
  const markCoverage = (category, week, detected) => {
    const item = coverageByCategory[category] || { expectedWeeks: 0, detectedWeeks: 0, missingWeeks: [] };
    item.expectedWeeks += 1;
    if (detected) item.detectedWeeks += 1;
    else item.missingWeeks.push(week);
    coverageByCategory[category] = item;
  };
  for (const [week, expected] of expectedByWeek.entries()) {
    const matched = matchedByWeek.get(week) || new Set();
    for (const category of expected) {
      // 일반 국가와 화종이 명시된 운송료는 대차수 합계 원천이므로 같은 대차수 어디에서든 1건이
      // 확인되면 충족한다. 콜롬비아 4품목 공유 운송료만 세부차수별 무게배분을 하므로 해당 주차의
      // 공유행이 필요하다. 단, 카네이션/장미 운송료처럼 화종이 명시된 행은 대차수 직접귀속이다.
      const detected = matchedCategories.has(category)
        || (isColombiaAllocatedCategory(category) && matched.has('콜롬비아 4품목'));
      markCoverage(category, week, detected);
      if (!detected) missingExpectedScopes.push({ orderWeek: week, category });
    }
  }
  for (const [category, coverage] of Object.entries(coverageByCategory)) {
    coverage.source = coverage.expectedWeeks === 0 ? 'missing'
      : coverage.detectedWeeks === 0 ? 'missing'
        : coverage.detectedWeeks < coverage.expectedWeeks ? 'partial' : 'auto';
  }
  for (const item of Object.values(totalsByCurrency)) item.delta = item.source - item.classified - item.unmatched;

  const unmatchedTotal = unmatchedRows.reduce((sum, row) => sum + row.amount, 0);
  const sourceTotal = sourceRows.reduce((sum, row) => sum + row.amount, 0);
  const classifiedTotal = classifiedRows.reduce((sum, row) => sum + row.amount, 0);
  const mappedTotal = Object.values(direct).reduce((sum, value) => sum + Number(value || 0), 0)
    + Object.values(colombiaRest).reduce((sum, value) => sum + Number(value || 0), 0);
  const classificationDelta = classifiedTotal - mappedTotal;
  const hardIssues = unmatchedRows.length + zeroValueRows.length + missingExpectedScopes.length
    + Object.values(totalsByCurrency).filter((item) => Math.abs(item.delta) > 0.01).length
    + (Math.abs(classificationDelta) > 0.01 ? 1 : 0);
  return {
    strict,
    status: strict && hardIssues > 0 ? 'incomplete' : hardIssues > 0 ? 'review' : 'ready',
    sourceRowCount: sourceRows.length,
    classifiedRowCount: classifiedRows.length,
    sourceTotal,
    classifiedTotal,
    mappedTotal,
    classificationDelta,
    unmatchedTotal,
    delta: sourceTotal - classifiedTotal - unmatchedTotal,
    totalsByCurrency,
    sourceRows,
    classifiedRows,
    unmatchedRows,
    zeroValueRows,
    missingExpectedScopes,
    coverageByCategory,
    direct,
    colombiaRest,
  };
}

// 콜롬비아 4품목 분류 SQL — lib/colombiaFlowerClassification.js(JS 단일 진실 소스)와 토큰 집합이
// 반드시 같아야 한다(__tests__/colombiaFlowerClassification.test.js가 정적 대조).
// 2026-08-12 결함수정: FlowerName 한글 리터럴만 매칭해 영문 ROSE/CARNATION/ALSTROEMERIA/RUSCUS
// 품목이 누락됐다 — FlowerName·ProdName 모두에서 한글+영문을 매칭한다.
const CASE_COLOMBIA_ALLOC = `
  CASE
    WHEN ISNULL(p.FlowerName,'') LIKE N'%장미%' OR ISNULL(p.FlowerName,'') LIKE N'%Rose%' OR ISNULL(p.ProdName,'') LIKE N'%Rose%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%카네이션%' OR ISNULL(p.FlowerName,'') LIKE N'%Carnation%' OR ISNULL(p.ProdName,'') LIKE N'%Carnation%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%알스트로%' OR ISNULL(p.FlowerName,'') LIKE N'%Alstro%' OR ISNULL(p.ProdName,'') LIKE N'%Alstro%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%루스커스%' OR ISNULL(p.FlowerName,'') LIKE N'%Ruscus%' OR ISNULL(p.ProdName,'') LIKE N'%Ruscus%' THEN N'콜롬비아 루스커스'
    ELSE NULL
  END`;

// 운송료/SERVICE FEE/현지상차운임 + Gross·Chargeable weight placeholder 행 제외 —
// lib/profitReportClassification.js isNonStockableItem()의 SQL 등가물(콜롬비아 무게배분 전용 스코프).
const COLOMBIA_ALLOC_EXCLUDE_SQL = `NOT (
  ISNULL(p.ProdName,N'') LIKE N'%운송료%' OR ISNULL(p.ProdName,N'') LIKE N'%SERVICE FEE%'
  OR ISNULL(p.ProdName,N'') LIKE N'%현지상차운임%' OR ISNULL(p.ProdName,N'') LIKE N'%현지상차 운임%'
  OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%GROSS WEIGHT%' OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%GROSS WEIGTH%'
  OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGHT%' OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGTH%'
)`;

// ── 단가표 (관리자 수정 가능, 전역 설정값 — key/value)
export const RATE_DEFAULTS = {
  BakSangRate: 460,          // 백상 창고료 원/kg
  Truck1t: 99000,            // 월드운송료 1t 트럭 단가
  Truck2_5t: 187000,         // 월드운송료 2.5t 트럭 단가
  Truck5t: 275000,           // 월드운송료 5t 트럭 단가
  QuarantinePerItemRate: 10000, // 선율 검역대행수수료 품목당 단가
  // 콜롬비아 4품목 박스당무게(kg)/CBM — Flower.BoxWeight/BoxCBM 기본시드값(2026-04-16_freight_cost.sql), 실측과 다를 수 있어 수정 가능
  BoxWeight_콜롬비아장미: 7, BoxCBM_콜롬비아장미: 10,
  BoxWeight_콜롬비아카네이션: 11, BoxCBM_콜롬비아카네이션: 11,
  BoxWeight_콜롬비아알스트로: 9.7, BoxCBM_콜롬비아알스트로: 7,
  BoxWeight_콜롬비아루스커스: 8, BoxCBM_콜롬비아루스커스: 9.6,
};

let _ensured = null;
export function ensureCustomsTables() {
  if (_ensured) return _ensured;
  _ensured = assertWebSchemaContract('profit-report-customs@3', [
    { table: 'WebCustomsRateConfig', columns: ['ConfigKey', 'Value', 'UpdatedBy', 'UpdatedAt'] },
    { table: 'WebCustomsWeekly', columns: ['OrderYear', 'MajorWeek', 'Category', ...COUNTRY_STORAGE_FIELDS, 'UpdatedBy', 'UpdatedAt'] },
    { table: 'WebColombiaWeekly', columns: ['OrderYear', 'OrderWeek', 'GW', 'CW', 'HandlingFee', 'ItemCount', 'Truck1t', 'Truck2_5t', 'Truck5t', 'CustomsFee', 'DisinfectFee', 'QuarantineDeductFee', 'AirRateUSD', 'BakSangRateApplied', 'UpdatedBy', 'UpdatedAt'] },
    { table: 'WebForwardingWeekly', columns: ['OrderYear', 'MajorWeek', 'Category', 'AmountUSD', 'UpdatedBy', 'UpdatedAt'] },
    { table: 'WebCustomsHistory', columns: ['OrderYear', 'ScopeType', 'ScopeKey', 'FieldName', 'OldValue', 'NewValue', 'ChangedBy', 'ChangedAt'] },
  ]);
  return _ensured;
}

/** GET/조회 전용 — 스키마를 변경하지 않고 migration 계약만 확인한다. */
export async function assertCustomsReadSchema() {
  await ensureCustomsTables();
}

// ── 이력 기록 — 바뀐 필드만 INSERT (둘 다 null/동일값이면 기록 안 함)
async function logHistory(tQ, orderYear, scopeType, scopeKey, fieldName, oldValue, newValue, actor) {
  const o = oldValue == null || oldValue === '' ? null : Number(oldValue);
  const n = newValue == null || newValue === '' ? null : Number(newValue);
  if (o === n) return;
  if (o != null && n != null && Math.abs(o - n) < 0.0001) return;
  await tQ(
    `INSERT INTO WebCustomsHistory (OrderYear, ScopeType, ScopeKey, FieldName, OldValue, NewValue, ChangedBy)
     VALUES (@yr, @st, @sk, @fn, @ov, @nv, @actor)`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) }, st: { type: sql.NVarChar, value: scopeType },
      sk: { type: sql.NVarChar, value: scopeKey }, fn: { type: sql.NVarChar, value: fieldName },
      ov: { type: sql.Float, value: o }, nv: { type: sql.Float, value: n },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
}

/** 특정 범위의 최근 수정이력 (최신순) — 화면에 "누가 언제 무엇을 얼마→얼마로" 표시용 */
export async function loadHistory(orderYear, scopeType, scopeKey, limit = 30) {
  await assertCustomsReadSchema();
  const r = await query(
    `SELECT TOP (${Number(limit) || 30}) FieldName, OldValue, NewValue, ChangedBy, CONVERT(varchar(19), ChangedAt, 120) AS ChangedAt
       FROM WebCustomsHistory WHERE OrderYear=@yr AND ScopeType=@st AND ScopeKey=@sk
      ORDER BY HistoryKey DESC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, st: { type: sql.NVarChar, value: scopeType }, sk: { type: sql.NVarChar, value: scopeKey } }
  );
  return r.recordset;
}

// ── 단가표
export async function getRateConfig(orderYear = null, major = null) {
  await assertCustomsReadSchema();
  const r = await query(`SELECT ConfigKey, Value FROM WebCustomsRateConfig`, {});
  const saved = Object.fromEntries(r.recordset.map((x) => [x.ConfigKey, Number(x.Value)]));
  if (orderYear == null || major == null) return { ...RATE_DEFAULTS, ...saved };
  const available = await query(
    `SELECT CASE WHEN OBJECT_ID(N'dbo.WebCustomsRateHistory', N'U') IS NULL THEN 0 ELSE 1 END AS TableExists`,
    {},
  );
  if (Number(available.recordset?.[0]?.TableExists || 0) !== 1) {
    return { ...RATE_DEFAULTS, ...saved };
  }
  const target = Number(orderYear) * 100 + Number(major);
  const history = await query(
    `WITH ranked AS (
       SELECT ConfigKey, Value,
              ROW_NUMBER() OVER (
                PARTITION BY ConfigKey
                ORDER BY TRY_CONVERT(INT, EffectiveOrderYear) DESC,
                         TRY_CONVERT(INT, EffectiveMajorWeek) DESC, AutoKey DESC
              ) AS rn
         FROM WebCustomsRateHistory
        WHERE TRY_CONVERT(INT, EffectiveOrderYear) * 100 + TRY_CONVERT(INT, EffectiveMajorWeek) <= @target
     )
     SELECT ConfigKey, Value FROM ranked WHERE rn=1`,
    { target: { type: sql.Int, value: target } },
  );
  const effective = Object.fromEntries(history.recordset.map((x) => [x.ConfigKey, Number(x.Value)]));
  return { ...RATE_DEFAULTS, ...saved, ...effective };
}
export async function saveRateConfig(values, actor, orderYear = null, major = null) {
  await ensureCustomsTables();
  if (orderYear != null || major != null) {
    await assertWebSchemaContract('profit-report-customs-rate-history@1', [
      { table: 'WebCustomsRateHistory', columns: ['ConfigKey', 'EffectiveOrderYear', 'EffectiveMajorWeek', 'Value', 'UpdatedBy', 'UpdatedAt'] },
    ]);
  }
  const current = await getRateConfig(orderYear, major);
  await withTransaction(async (tQ) => {
    for (const [key, value] of Object.entries(values || {})) {
      if (!(key in RATE_DEFAULTS)) continue; // 알 수 없는 키 무시(오타 방지)
      await logHistory(tQ, '_global', 'Rate', key, 'Value', current[key], value, actor);
      await tQ(
        `MERGE WebCustomsRateConfig AS t USING (SELECT @k AS ConfigKey) AS s ON t.ConfigKey=s.ConfigKey
         WHEN MATCHED THEN UPDATE SET Value=@v, UpdatedBy=@actor, UpdatedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (ConfigKey, Value, UpdatedBy) VALUES (@k, @v, @actor);`,
        { k: { type: sql.NVarChar, value: key }, v: { type: sql.Float, value: Number(value) }, actor: { type: sql.NVarChar, value: actor || 'user' } }
      );
      if (orderYear != null && major != null) {
        await tQ(
          `MERGE WebCustomsRateHistory AS t
           USING (SELECT @k AS ConfigKey, @yr AS EffectiveOrderYear, @mw AS EffectiveMajorWeek) AS s
              ON t.ConfigKey=s.ConfigKey
             AND t.EffectiveOrderYear=s.EffectiveOrderYear
             AND t.EffectiveMajorWeek=s.EffectiveMajorWeek
           WHEN MATCHED THEN UPDATE SET Value=@v, UpdatedBy=@actor, UpdatedAt=GETDATE()
           WHEN NOT MATCHED THEN
             INSERT (ConfigKey, EffectiveOrderYear, EffectiveMajorWeek, Value, UpdatedBy)
             VALUES (@k, @yr, @mw, @v, @actor);`,
          {
            k: { type: sql.NVarChar, value: key },
            yr: { type: sql.NVarChar, value: String(orderYear) },
            mw: { type: sql.NVarChar, value: String(major).padStart(2, '0') },
            v: { type: sql.Float, value: Number(value) },
            actor: { type: sql.NVarChar, value: actor || 'user' },
          },
        );
      }
    }
  });
}

// ── 세부차수(반차수) 목록 — 그 대차수에 실제 입고 데이터가 있는 세부차수
export async function weeksForMajor(major, orderYear) {
  const r = await query(
    `SELECT DISTINCT OrderWeek FROM WarehouseMaster WHERE OrderYear=@yr AND OrderWeek LIKE @pfx AND ISNULL(isDeleted,0)=0`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, pfx: { type: sql.NVarChar, value: `${major}-%` } }
  );
  const weeks = r.recordset.map((x) => x.OrderWeek).sort();
  return weeks.length ? weeks : [`${major}-01`, `${major}-02`]; // 데이터 없으면 관례상 1/2차로 폼만 노출
}

// ── 입고 GW 기본값 병합 — 수기 저장값 우선, 없으면 입고관리 Gross weight 사용 (사용자 방침: 입고 GW = 기준)
export function mergeCountryGw(row, gwDef) {
  const eff = { ...(row || {}) };
  // 0도 의도된 직접 override다. NULL/미저장일 때만 입고 GW를 병합한다.
  if ((eff.GW1 == null || eff.GW1 === '') && Number(gwDef?.GW1) > 0) eff.GW1 = gwDef.GW1;
  if ((eff.GW2 == null || eff.GW2 === '') && Number(gwDef?.GW2) > 0) eff.GW2 = gwDef.GW2;
  return eff;
}
export function mergeColombiaGw(row, gwDef) {
  const eff = { ...(row || {}) };
  if (!(Number(eff.GW) > 0) && Number(gwDef?.GW) > 0) eff.GW = gwDef.GW;
  if (!(Number(eff.CW) > 0) && Number(gwDef?.CW) > 0) eff.CW = gwDef.CW;
  return eff;
}

/**
 * 콜롬비아 반차수 트럭 대수 병합.
 *
 * 2026-08-12 결함수정: 이전 구현은 GW만 있으면 **저장된 실제 차량 대수를 자동 추천값으로 덮어썼다**.
 * 과거 차수의 실제 차량·비용은 그대로 보존해야 하므로(사용자 확정 규칙), 저장행에 대수가 하나라도
 * 있으면 그 값을 그대로 쓰고 추천값은 화면 힌트(truckAuto)로만 넘긴다. 저장 대수가 전혀 없을 때만
 * 합산 GW 용량분해 추천값을 적용한다.
 */
export function mergeColombiaTruck(row, gwDef) {
  const eff = { ...(row || {}) };
  const grossWeight = Number(eff.GW) > 0 ? Number(eff.GW) : Number(gwDef?.GW) || 0;
  if (hasExplicitTruckCounts(row)) {
    eff.truckSource = 'saved_actual';
    return eff;
  }
  if (grossWeight > 0) {
    const plan = deriveTruckPlan(grossWeight);
    for (const type of TRUCK_TYPES) eff[type.key] = plan[type.key];
    eff.truckSource = plan.source;
  }
  return eff;
}

// ── 이 차수에 입고가 있는 국가 카테고리 — 입력 화면에서 필요한 행만 노출(나머지는 접기)
export async function activeCustomsCategories(major, orderYear) {
  const r = await query(
    `SELECT LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS coun,
            SUM(CASE WHEN p.FlowerName LIKE N'%수국%' THEN 1 ELSE 0 END) AS hydCnt
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
      WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderWeek LIKE @pfx
        AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @yr) = @yr
      GROUP BY LTRIM(RTRIM(ISNULL(p.CounName, N'')))`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const set = new Set();
  for (const row of r.recordset) {
    const c = String(row.coun || '').trim();
    if (/콜롬비아/.test(c) && Number(row.hydCnt) > 0) set.add('콜롬비아 수국');
    for (const cat of COUNTRY_CATEGORIES) {
      if (cat === '콜롬비아 수국') continue;
      if (c && (c === cat || c.includes(cat))) set.add(cat);
    }
  }
  return [...set];
}

// ── 입고관리 Gross/Chargeable weight — 그외통관비 무게(백상 창고료 kg) 기준값.
// 특수 품목행의 Box/Bunch/Steam/OutQuantity 중 실제 중량을 freightCalc와 동일하게 추출한다.
// 국가 판별은 농장명 고정 목록보다 같은 AWB의 Product.CounName을 우선하고,
// FREIGHTWISE/InvoiceNo 태그와 기존 농장명 패턴을 fallback으로 사용한다.
export async function loadWarehouseGw(major, orderYear) {
  const r = await query(
    `SELECT wm.WarehouseKey, wm.OrderWeek, wm.OrderNo AS AWB,
            LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) AS farm,
            LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))) AS inv,
            ISNULL(wm.GrossWeight,0) AS masterGW,
            ISNULL(wm.ChargeableWeight,0) AS masterCW,
            wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.OutQuantity,
            LTRIM(RTRIM(ISNULL(p.ProdName, N''))) AS prodName,
            LTRIM(RTRIM(ISNULL(p.FlowerName, N''))) AS flowerName,
            LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS counName
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
      WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderWeek LIKE @pfx
        AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @yr) = @yr`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const countries = {}; // 카테고리 → { GW1, GW2 }
  const colombia = {};  // 반차수 → { GW, CW } (콜카장 4품목)

  // 국가 판별(baseCountry)은 lib/countryClassification.js 공용 규칙을 사용한다(모듈 상단 import/re-export).
  // normalizeToken/normalizeAwb는 AWB·농장명 정규화 전용(국가 매칭과 무관)이라 이 파일에 남긴다.
  const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const normalizeAwb = (value) => normalizeToken(value).replace(/-/g, '');
  const entries = new Map();
  const awbContext = new Map();
  const addContext = (map, key, row) => {
    const k = normalizeAwb(key);
    if (!k) return;
    const ctx = map.get(k) || { countries: new Set(), flowers: new Set() };
    const country = baseCountry(row.counName);
    if (country) ctx.countries.add(country);
    if (row.flowerName) ctx.flowers.add(row.flowerName);
    map.set(k, ctx);
  };

  for (const row of r.recordset) {
    const e = entries.get(row.WarehouseKey) || {
      warehouseKey: row.WarehouseKey, orderWeek: row.OrderWeek, awb: row.AWB,
      farm: row.farm, inv: row.inv, masterGW: Number(row.masterGW) || 0, masterCW: Number(row.masterCW) || 0,
      gw: 0, cw: 0, countries: new Set(), flowers: new Set(),
    };
    const isGross = isGrossWeightItem(row.prodName);
    const isChargeable = isChargeableWeightItem(row.prodName);
    if (isGross) e.gw += freightWeightOfRow(row);
    if (isChargeable) e.cw += freightWeightOfRow(row);
    const country = baseCountry(row.counName);
    // Freight Wise 업로드가 특수 GW/CW 행 자체에 국가를 저장하는 경우도 보존한다.
    if (country) e.countries.add(country);
    if (!isFreightItem(row.prodName)) {
      if (row.flowerName) e.flowers.add(row.flowerName);
      addContext(awbContext, row.AWB, row);
    }
    entries.set(row.WarehouseKey, e);
  }

  const toArray = (set) => [...(set || [])];
  const inferCategory = (entry) => {
    const inv = normalizeToken(entry.inv);
    const farm = normalizeToken(entry.farm);
    const ownCountries = toArray(entry.countries);
    const context = awbContext.get(normalizeAwb(entry.awb));
    const contextCountries = toArray(context?.countries);
    const flowers = [...toArray(entry.flowers), ...toArray(context?.flowers)];
    const text = `${inv} ${farm} ${flowers.join(' ')}`.toLowerCase();
    const isHydrangea = /수국|hydrangea/.test(text);
    const knownCountry = baseCountry(ownCountries.length === 1 ? ownCountries[0] : '')
      || baseCountry(contextCountries.length === 1 ? contextCountries[0] : '')
      || baseCountry(entry.farm);
    if (knownCountry === '콜롬비아') return isHydrangea ? '콜롬비아 수국' : '콜롬비아 4품목';
    if (knownCountry) return knownCountry;
    if (/수국|hydrangea/.test(inv) && /freightwise|apollo/.test(farm)) return '콜롬비아 수국';
    if (/^freightwiseecuador/.test(farm)) return '에콰도르';
    if (/^freightwise|^apollo/.test(farm) && (/콜수국/.test(inv))) return '콜롬비아 수국';
    if (/^freightwise|^apollo/.test(farm) && (/콜카장/.test(inv))) return '콜롬비아 4품목';
    if (/^holex|^ezflower/.test(farm)) return '네덜란드';
    if (/^excel$/.test(farm)) return '태국';
    if (/^cloudland|^yunnan/.test(farm)) return '중국';
    return null;
  };

  for (const entry of entries.values()) {
    const half = /-0?2$/.test(entry.orderWeek) ? 2 : 1;
    const gw = entry.gw > 1 ? entry.gw : entry.masterGW > 1 ? entry.masterGW : 0;
    const cw = entry.cw > 1 ? entry.cw : entry.masterCW > 1 ? entry.masterCW : 0;
    if (gw <= 0 && cw <= 0) continue;
    const cat = inferCategory(entry);
    if (cat === '콜롬비아 4품목') {
      const c = colombia[entry.orderWeek] || (colombia[entry.orderWeek] = { GW: 0, CW: 0 });
      c.GW += gw; c.CW += cw;
      continue;
    }
    if (!cat) continue;
    const e = countries[cat] || (countries[cat] = { GW1: 0, GW2: 0, CW1: 0, CW2: 0 });
    e[half === 1 ? 'GW1' : 'GW2'] += gw;
    e[half === 1 ? 'CW1' : 'CW2'] += cw;
  }
  return { countries, colombia };
}

// ── 콜롬비아 4품목 박스수량 — WarehouseDetail 자동집계(수정 가능, 화면에서 override)
export async function colombiaBoxQtyByCategory(orderWeek, orderYear) {
  const r = await query(
    `SELECT ${CASE_COLOMBIA_ALLOC} AS Category, SUM(ISNULL(wd.BoxQuantity,0)) AS q
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek=@wk AND wm.OrderYear=@yr AND ISNULL(wm.isDeleted,0)=0
        AND ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ${COLOMBIA_ALLOC_EXCLUDE_SQL}
        AND (${CASE_COLOMBIA_ALLOC}) IS NOT NULL
      GROUP BY ${CASE_COLOMBIA_ALLOC}`,
    { wk: { type: sql.NVarChar, value: orderWeek }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, Number(x.q)]));
}

/** 포워딩(S) 자동감지 — WarehouseDetail 의 운송료/항공료/FREIGHT/SERVICE FEE 라인을 국가별로 자동 집계.
 * 2단계 판별(2026-07-10, 22~26차 6개 반차수 54건 실측 대조 — 미분류 0건):
 *  ① 같은 BILL(WarehouseKey) 안에 실제 꽃(국내 아닌 CounName) 라인이 있으면 그 국가 사용
 *     — 네덜란드(Holex 등)·중국(Yunnan Melody/Cloudland 등, 매주 다른 농장)은 이 경로로만 잡힘,
 *       또 콜롬비아 농장 인보이스에 운송료가 한 줄 섞인 경우(Flores De Funza 등 소액)도 이 경로로 정확히 잡힘.
 *  ② 없으면(=BILL 전체가 순수 운송료, FREIGHTWISE AWB류) FarmName 패턴 매칭.
 * 콜롬비아는 InvoiceNo 로 '수국'(국가레벨 직접) vs 나머지4품목(반차수별 무게배분용 total)을 나눈다.
 * 반환: { direct: {카테고리: USD합}, colombiaRest: {반차수: USD합} } */
export async function autoForwardingByCountry(major, orderYear) {
  const r = await query(
    `SELECT wm.OrderYear, wm.OrderWeek, wm.WarehouseKey, wm.OrderNo, wm.FarmName, wm.InvoiceNo,
            wd.WdetailKey AS WarehouseDetailKey, wd.ProdKey, wd.TPrice,
            wd.OutQuantity, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
            p.ProdName, p.FlowerName, p.CounName
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
      WHERE ISNULL(wm.isDeleted,0)=0
        AND wm.OrderWeek LIKE @pfx AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)),'')=@yr`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const ledger = buildForwardingLedger(r.recordset, { major, orderYear });
  return { direct: ledger.direct, colombiaRest: ledger.colombiaRest, ledger };
}

// ── 국가별(수국 포함) 그외통관비 저장값 로드/저장
export async function loadCustomsWeekly(major, orderYear) {
  await assertCustomsReadSchema();
  const r = await query(
    `SELECT * FROM WebCustomsWeekly WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, hydrateCountrySplitColumns(x)]));
}

// 구형 저장값은 합계 컬럼만 있으므로 1차 첫 번째 칸으로 표시해 사용자가 기존 금액을 잃지 않게 한다.
export function hydrateCountrySplitColumns(row) {
  const out = { ...(row || {}) };
  for (const group of COUNTRY_SPLIT_GROUPS) {
    const hasPart = group.parts.some((field) => out[field] != null && out[field] !== '');
    if (!hasPart && out[group.total] != null && out[group.total] !== '') out[group.parts[0]] = out[group.total];
  }
  return out;
}

// 분할 입력값이 하나라도 전달되면 합계 컬럼을 서버에서 다시 계산한다.
// 따라서 화면/외부 호출자가 합계값을 임의로 보내도 저장 원칙이 흔들리지 않는다.
export function normalizeCountryInput(row) {
  const out = { ...(row || {}) };
  for (const group of COUNTRY_SPLIT_GROUPS) {
    const hasPart = group.parts.some((field) => Object.prototype.hasOwnProperty.call(out, field));
    if (hasPart) out[group.total] = group.parts.reduce((sum, field) => sum + n0(out[field]), 0);
  }
  return out;
}

export async function saveCustomsWeekly(major, orderYear, category, row, actor) {
  return saveCustomsWeeklyBatch(major, orderYear, [{ category, row }], actor);
}

export async function saveCustomsWeeklyBatch(major, orderYear, entries, actor) {
  await ensureCustomsTables();
  const deduped = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const category = String(entry?.category || '').trim();
    if (category) deduped.set(category, { category, row: entry?.row || {} });
  }
  if (!deduped.size) return;
  const existingRows = await loadCustomsWeekly(major, orderYear);
  const currentRates = await getRateConfig(orderYear, major);
  const effectiveBakSangRate = effectiveRatesForWeek(currentRates, orderYear, major, 'country').BakSangRate;
  await withTransaction(async (tQ) => {
    for (const { category, row: input } of deduped.values()) {
      const row = normalizeCountryInput(input);
      // 저장 시점 유효 백상 창고료 요율 스냅샷 — 이후 전역 요율(RATE_DEFAULTS/WebCustomsRateConfig)이
      // 바뀌어도 이미 저장된 행의 계산은 저장 당시 요율 그대로 보존한다. 호출자가 이미 명시적으로
      // 값을 넘겼으면(드묾) 그대로 존중한다. 다른 실제 입력 필드가 하나도 없으면(빈 저장 클릭 등)
      // 요율만 저장해 빈 행을 만들지 않는다 — 2026 22~27차처럼 저장행이 없어야 감사 기준값
      // 폴백이 적용되는 차수에서, 빈 클릭이 조용히 빈 저장행을 만들어 감사값을 0으로 덮어쓰는
      // 사고를 막기 위함이다.
      const hasOtherField = COUNTRY_STORAGE_FIELDS.some((c) => c !== 'BakSangRateApplied' && Object.prototype.hasOwnProperty.call(row, c));
      if (hasOtherField && !Object.prototype.hasOwnProperty.call(row, 'BakSangRateApplied')) {
        row.BakSangRateApplied = effectiveBakSangRate;
      }
      const existing = existingRows[category] || {};
      const scopeKey = `${major}|${category}`;
      const params = {
        yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major },
        cat: { type: sql.NVarChar, value: category }, actor: { type: sql.NVarChar, value: actor || 'user' },
      };
      const setSql = [], insCol = [], insVal = [];
      for (const c of COUNTRY_STORAGE_FIELDS) {
        // 화면이 GW 기반 자동 월드 운송료를 표시하더라도, 명시적 입력이 없으면
        // 그 자동값을 수기 저장값으로 굳히지 않는다. 각 컬럼 부분 업데이트를 허용해
        // 다음 입고 GW/단가 변경 시 자동 재계산될 수 있게 한다.
        if (!Object.prototype.hasOwnProperty.call(row, c)) continue;
        const v = row[c];
        const isManualFlag = c === 'WorldFreight1Manual' || c === 'WorldFreight2Manual';
        params[c] = {
          type: isManualFlag ? sql.Bit : sql.Float,
          value: v == null || v === '' ? null : Number(v),
        };
        setSql.push(`[${c}]=@${c}`); insCol.push(`[${c}]`); insVal.push(`@${c}`);
        await logHistory(tQ, orderYear, 'Country', scopeKey, c, existing[c], v, actor);
      }
      if (!setSql.length) continue;
      await tQ(
        `MERGE WebCustomsWeekly AS t
         USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category) AS s
            ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category
         WHEN MATCHED THEN UPDATE SET ${setSql.join(',')}, UpdatedBy=@actor, UpdatedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, ${insCol.join(',')}, UpdatedBy)
              VALUES (@yr, @mw, @cat, ${insVal.join(',')}, @actor);`,
        params
      );
    }
  });
}

// ── 콜롬비아 반차수 공유값(그외통관비+포워딩) 로드/저장
export async function loadColombiaWeekly(orderWeek, orderYear) {
  await assertCustomsReadSchema();
  const r = await query(
    `SELECT * FROM WebColombiaWeekly WHERE OrderYear=@yr AND OrderWeek=@wk`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: orderWeek } }
  );
  return r.recordset[0] || null;
}
export async function saveColombiaWeekly(orderWeek, orderYear, row, actor) {
  await ensureCustomsTables();
  const cols = ['GW', 'CW', 'HandlingFee', 'ItemCount', 'Truck1t', 'Truck2_5t', 'Truck5t', 'CustomsFee', 'DisinfectFee', 'QuarantineDeductFee', 'AirRateUSD', 'BakSangRateApplied'];
  const existing = (await loadColombiaWeekly(orderWeek, orderYear)) || {};
  const major = String(orderWeek).split('-')[0];
  const currentRates = await getRateConfig(orderYear, major);
  const effectiveBakSangRate = effectiveRatesForWeek(currentRates, orderYear, major, 'colombia').BakSangRate;
  // 저장 시점 유효 백상 창고료 요율 스냅샷 — saveCustomsWeeklyBatch와 동일 정책. 다른 실제 필드가
  // 하나도 없으면 요율만 저장해 빈 행을 만들지 않는다(감사 기준값 폴백을 빈 클릭으로 덮어쓰지 않기 위함).
  const hasOtherField = cols.some((c) => c !== 'BakSangRateApplied' && Object.prototype.hasOwnProperty.call(row, c));
  const input = !hasOtherField || Object.prototype.hasOwnProperty.call(row, 'BakSangRateApplied')
    ? row
    : { ...row, BakSangRateApplied: effectiveBakSangRate };
  const params = {
    yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: orderWeek },
    actor: { type: sql.NVarChar, value: actor || 'user' },
  };
  const setSql = [], insCol = [], insVal = [];
  for (const c of cols) {
    if (!(c in input)) continue; // 부분 업데이트 허용(그외통관비 화면/포워딩 화면이 각자 자기 컬럼만 보냄)
    const v = input[c];
    params[c] = { type: sql.Float, value: v == null || v === '' ? null : Number(v) };
    setSql.push(`${c}=@${c}`); insCol.push(c); insVal.push(`@${c}`);
  }
  if (!setSql.length) return;
  await withTransaction(async (tQ) => {
    for (const c of cols) { if (c in input) await logHistory(tQ, orderYear, 'Colombia', orderWeek, c, existing[c], input[c], actor); }
    await tQ(
      `MERGE WebColombiaWeekly AS t
       USING (SELECT @yr AS OrderYear, @wk AS OrderWeek) AS s
          ON t.OrderYear=s.OrderYear AND t.OrderWeek=s.OrderWeek
       WHEN MATCHED THEN UPDATE SET ${setSql.join(',')}, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, OrderWeek, ${insCol.join(',')}, UpdatedBy)
            VALUES (@yr, @wk, ${insVal.join(',')}, @actor);`,
      params
    );
  });
}

// ── 국가별 포워딩(USD) 직접입력 로드/저장
export async function loadForwardingWeekly(major, orderYear) {
  await assertCustomsReadSchema();
  const r = await query(
    `SELECT Category, AmountUSD FROM WebForwardingWeekly WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, Number(x.AmountUSD)]));
}
export async function saveForwardingWeekly(major, orderYear, category, amountUSD, actor) {
  await ensureCustomsTables();
  const scopeKey = `${major}|${category}`;
  const existing = await loadForwardingWeekly(major, orderYear);
  await withTransaction(async (tQ) => {
    await logHistory(tQ, orderYear, 'Forwarding', scopeKey, 'AmountUSD', existing[category], amountUSD, actor);
    await tQ(
      `MERGE WebForwardingWeekly AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category
       WHEN MATCHED THEN UPDATE SET AmountUSD=@v, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, AmountUSD, UpdatedBy)
            VALUES (@yr, @mw, @cat, @v, @actor);`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major }, cat: { type: sql.NVarChar, value: category },
        v: { type: sql.Float, value: amountUSD == null || amountUSD === '' ? null : Number(amountUSD) },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      }
    );
  });
}

// ── 순수 계산 함수 (DB 의존 없음, 화면 미리보기·API 공용)
const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * 입고 Gross Weight → 월드 운송료 **추천** 차량/금액(용량 분해, lib/colombiaTruck.js deriveTruckPlan).
 * 저장된 실제 WorldFreight 금액이 없을 때만 이 추천값을 사용하며, 추천값 자체를 DB에 수기값으로
 * 저장하지 않는다. 3t=2.5t+1t처럼 "비용최저 1대"가 아니라 용량 단위 분해가 규칙이다.
 */
export function deriveWorldFreight(grossWeight, rates = RATE_DEFAULTS) {
  const plan = deriveTruckPlan(grossWeight);
  const amount = TRUCK_TYPES.reduce((sum, type) => sum + plan[type.key] * n0(rates?.[type.rateKey]), 0);
  return {
    ...plan,
    amount: Math.round(amount),
    source: plan.source === 'missing' ? 'missing' : 'warehouse_gw_auto',
  };
}

function hasExplicitValue(row, field) {
  return Object.prototype.hasOwnProperty.call(row || {}, field)
    && row[field] != null && row[field] !== '';
}

// effectiveRatesForWeek는 lib/customsForwardingCalc.js로 이동(DB 의존 없음, 클라이언트 안전) —
// 위 import/export로 재노출한다.

/** 현재 국가행의 GW와 월드 운송료를 계산에 사용할 형태로 만든다.
 *
 * 추천값은 그 대차수 국가의 GW1+GW2 **합산** 중량을 용량 단위로 분해해(deriveWorldFreight)
 * 1차 칸에 전액 반영하고 2차는 0으로 둔다 — 반차수마다 따로 트럭을 잡으면 같은 대차수 물량이
 * 두 번 계산된다.
 *
 * 실제값 우선 규칙(2026-08-12): 1차/2차 중 한쪽이라도 명시적 실제값(WorldFreight{1,2}Manual=1)이면
 * 그 값을 그대로 보존한다. 22~27차 historical snapshot 행은 Manual=1로 표시되어 들어오므로,
 * 원본 엑셀의 실제 청구액(예: 27차 콜롬비아 수국 4,508kg → 실제 2.5t 187,000원)이 추천값
 * (용량분해 2.5t+1t×3)으로 덮이지 않는다. Manual 표시가 없는 레거시 리터럴만 추천값으로 대체하며,
 * 추천값 자체를 낼 수 없을 때(GW가 전혀 없는 구형 데이터)는 레거시 리터럴을 보존한다. */
export function effectiveCountryWorldFreight(row, gwDef, rates = RATE_DEFAULTS) {
  const effective = mergeCountryGw(row, gwDef);
  const combinedGw = n0(effective.GW1) + n0(effective.GW2);
  const combined = deriveWorldFreight(combinedGw, rates);
  const out = { ...effective };
  const manual1 = Number(row?.WorldFreight1Manual) === 1;
  const manual2 = Number(row?.WorldFreight2Manual) === 1;
  const legacy1 = hasExplicitValue(row, 'WorldFreight1');
  const legacy2 = hasExplicitValue(row, 'WorldFreight2');

  // 화면 힌트용 자동값 — override 여부와 무관하게 "결합 GW라면 얼마인지"는 항상 계산해 보여준다.
  const auto = { WorldFreight1: vatInclusiveToNet(combined.amount), WorldFreight2: 0 };

  // 1차: 수기 override > 결합 GW 자동(차량 조합 전액) > 레거시 리터럴 > 0
  out.WorldFreight1 = manual1 ? n0(row.WorldFreight1)
    : combined.amount > 0 ? combined.amount
    : legacy1 ? n0(row.WorldFreight1) : 0;

  // 2차: 수기 override > (결합 GW 자동값이 있으면 항상 0 — 1차에 이미 차량 조합 전액을 반영했으므로
  // 레거시 리터럴이 남아있어도 그대로 더하면 이중계상된다) > 결합 자동값을 낼 수 없을 때만 레거시
  // 리터럴 보존(과거 저장분을 조용히 지우지 않기 위함, GW가 전혀 없는 예외적 구형 데이터용) > 0.
  out.WorldFreight2 = manual2 ? n0(row.WorldFreight2)
    : combined.amount > 0 ? 0
    : legacy2 ? n0(row.WorldFreight2) : 0;

  const source = {
    WorldFreight1: manual1 ? 'manual_override' : combined.amount > 0 ? combined.source : legacy1 ? 'legacy_saved' : 'missing',
    WorldFreight2: manual2 ? 'manual_override' : combined.amount > 0 ? 'combined_gw_zeroed' : legacy2 ? 'legacy_saved' : 'missing',
  };

  return { row: out, auto, source };
}

// computeCountryCustomsTotal/computeColombiaCustomsTotal/computeColombiaRatios/computeColombiaAllocation/
// computeColombiaAllocationFromTotal은 lib/customsForwardingCalc.js(DB 의존 없는 순수 계산, 클라이언트
// 안전)로 이동했다 — 위 import/export로 재노출한다(2026-08-12 결함수정: 그외통관비 입력화면이 수기
// 편집 중 stale 합계를 보여주던 문제를 고치기 위해 클라이언트가 같은 계산식을 직접 재사용해야 했다).

/** 국가(콜롬비아 수국 포함) 1건의 유효 H.
 *
 * 우선순위: **운영 저장행(WebCustomsWeekly) > 원본 엑셀 historical snapshot(2026 22~27차) >
 * 입고 GW 자동추천 > 없음(0)**. 저장행이 조금이라도 있으면 historical snapshot은 전혀 쓰지 않는다
 * (행 단위 폴백 — 운영자 입력을 절대 덮지 않는다).
 *
 * 2026-08-12 변경: historical snapshot은 "최종 H 합계"가 아니라 **구성요소 행**이다. 따라서 어느
 * 경로든 총액은 항상 같은 공식(computeCountryCustomsTotal)으로 계산되고, 화면은 백상 GW·관세·선율·
 * 월드운송료·한국방역을 그대로 볼 수 있다 — 원천 누락을 합계 숫자로 덮지 않는다.
 *
 * profit-report 실계산(computeCustomsAndForwarding)과 그외통관비 입력화면 미리보기
 * (customs-clearance API)가 이 함수 하나만 써야 두 화면이 항상 일치한다.
 *
 * 반환의 `row`는 실제 계산에 들어간 유효 입력행이다(화면이 구성요소를 그대로 표시할 수 있도록). */
export function resolveCountryCustomsTotal({ row, gwDef, rates, category, orderYear, major }) {
  const historicalRow = row ? null : getHistoricalCountryCustomsRow(orderYear, major, category);
  const effectiveRates = effectiveRatesForWeek(rates, orderYear, major, 'country');
  const baseRow = row || historicalRow;
  const world = effectiveCountryWorldFreight(baseRow, gwDef, effectiveRates);
  const hasGwAuto = Number(gwDef?.GW1) > 0 || Number(gwDef?.GW2) > 0;
  const usable = baseRow || hasGwAuto ? world.row : null;
  return {
    total: computeCountryCustomsTotal(usable, effectiveRates, category),
    row: usable,
    source: row ? 'saved' : historicalRow ? HISTORICAL_CUSTOMS_SOURCE : hasGwAuto ? 'gw_auto' : 'missing',
    world,
    effectiveRates,
  };
}

/** 콜롬비아 4품목 반차수 1건의 유효 배분값.
 *
 * 우선순위는 resolveCountryCustomsTotal과 같다: **운영 저장행(WebColombiaWeekly) >
 * 원본 엑셀 historical snapshot(2026 22~27차) > 입고 GW 자동추천 > 없음**. historical snapshot은
 * 구성요소 행(GW/CW/통관수수료/품목수/실제 트럭 대수/관세료/소독/검역 + 백상요율 스냅샷)과
 * 원본 배분 박스수량을 함께 갖고 있으므로, 총액도 배분비율도 같은 프로덕션 공식으로 계산된다.
 * 박스수량을 historical 값으로 쓰는 이유는 현재 창고 DB 상태가 그 주의 원본과 다를 수 있어서다.
 *
 * 저장행이 있으면 그 안의 실제 트럭 대수를 그대로 쓴다(mergeColombiaTruck) — 자동추천이 실제값을
 * 덮지 않는다. 추천값은 별도로 truckAuto에 실어 화면이 "추천 vs 실제"를 구분해 표시하게 한다. */
export function resolveColombiaCustomsAllocation({ orderWeek, orderYear, major, colRow, boxQty, gwDef, airTotal, rates }) {
  const resolvedMajor = major || String(orderWeek).split('-')[0];
  const effectiveRates = effectiveRatesForWeek(rates, orderYear, resolvedMajor, 'colombia');
  const historical = colRow ? null : getHistoricalColombiaWeekly(orderYear, orderWeek);
  const effectiveRow = historical
    ? { ...historical.row }
    : mergeColombiaTruck(mergeColombiaGw(colRow, gwDef), gwDef);
  const effectiveBoxQty = historical ? historical.boxQty : boxQty;
  const gw = Number(effectiveRow.GW) || 0;
  return {
    allocation: computeColombiaAllocation({ ...effectiveRow, AirRateUSD: airTotal }, effectiveBoxQty, effectiveRates),
    total: computeColombiaCustomsTotal(effectiveRow, effectiveRates),
    row: effectiveRow,
    boxQty: effectiveBoxQty,
    gw,
    truckActual: { Truck1t: n0(effectiveRow.Truck1t), Truck2_5t: n0(effectiveRow.Truck2_5t), Truck5t: n0(effectiveRow.Truck5t) },
    truckAuto: gw > 0 ? deriveTruckPlan(gw) : null,
    truckSource: historical ? HISTORICAL_CUSTOMS_SOURCE : (effectiveRow.truckSource || null),
    source: colRow ? 'saved' : historical ? HISTORICAL_CUSTOMS_SOURCE : (gw > 0 ? 'gw_auto' : 'missing'),
    effectiveRates,
  };
}

/** 대차수(major) 전체 카테고리의 H(그외통관비)/S(포워딩) — profit-report API 에서 호출하는 최상위 함수.
 * S(포워딩)는 autoForwardingByCountry(입고관리 자동감지)가 1순위, WebForwardingWeekly/WebColombiaWeekly
 * 수기 저장값은 자동감지가 놓친 경우(새 농장명 패턴 미매칭 등)를 덮어쓰는 override 로만 쓰인다.
 * H는 국가/콜롬비아 모두 resolveCountryCustomsTotal/resolveColombiaCustomsAllocation을 거쳐
 * 2026 22~27차의 감사 기준값을 저장행이 없을 때만 대체값으로 반영한다. */
export async function computeCustomsAndForwarding(major, orderYear) {
  await assertCustomsReadSchema();
  const [rates, countryRows, fwdRows, subWeeks, autoFwd, autoGw] = await Promise.all([
    getRateConfig(orderYear, major),
    loadCustomsWeekly(major, orderYear),
    loadForwardingWeekly(major, orderYear),
    weeksForMajor(major, orderYear),
    autoForwardingByCountry(major, orderYear),
    loadWarehouseGw(major, orderYear), // 입고 GW = 무게 기준값 (수기 없으면 자동 사용)
  ]);

  const H = {}, S = {}, HSource = {}, SSource = {}, HComponents = {};
  for (const cat of COUNTRY_CATEGORIES) {
    const row = countryRows[cat] || null;
    const gwDef = autoGw.countries?.[cat];
    const resolved = resolveCountryCustomsTotal({ row, gwDef, rates, category: cat, orderYear, major });
    H[cat] = resolved.total;
    HSource[cat] = resolved.source;
    // 화면이 "H가 왜 이 금액인지"를 구성요소로 그대로 보여줄 수 있게 유효 입력행을 함께 반환한다.
    HComponents[cat] = resolved.row
      ? {
        GW1: n0(resolved.row.GW1), GW2: n0(resolved.row.GW2),
        Customs1: n0(resolved.row.Customs1), Customs2: n0(resolved.row.Customs2),
        SunYul1: n0(resolved.row.SunYul1), SunYul2: n0(resolved.row.SunYul2),
        WorldFreight1: n0(resolved.row.WorldFreight1), WorldFreight2: n0(resolved.row.WorldFreight2),
        Quarantine1: n0(resolved.row.Quarantine1), Quarantine2: n0(resolved.row.Quarantine2),
        BakSangRateApplied: n0(resolved.row.BakSangRateApplied) > 0
          ? n0(resolved.row.BakSangRateApplied) : n0(resolved.effectiveRates.BakSangRate),
      }
      : null;
  }
  // 자동분류는 모든 국가 카테고리를 대상으로 한다. FORWARDING_DIRECT_CATEGORIES는 기존 수기입력 UI 범위만 유지한다.
  for (const cat of COUNTRY_CATEGORIES) {
    const overridden = fwdRows[cat] != null;
    const detected = Object.prototype.hasOwnProperty.call(autoFwd.direct, cat);
    S[cat] = overridden ? Number(fwdRows[cat]) : (autoFwd.direct[cat] || 0); // 수기 override > 자동감지
    const coverageSource = autoFwd.ledger?.coverageByCategory?.[cat]?.source;
    SSource[cat] = overridden ? 'manual_override' : coverageSource || (detected ? 'auto' : 'missing');
  }

  for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
    H[cat] = 0;
    // 품목명이 카네이션/장미/루스커스 운송료처럼 대상을 명시한 항공료는 공유 풀에 넣지 않고 직접 귀속한다.
    S[cat] = Number(autoFwd.direct?.[cat] || 0);
  }
  const colombiaWeekDetails = [];
  let colombiaSavedCount = 0;
  let colombiaHistoricalCount = 0;
  let colombiaGwAutoCount = 0;
  let colombiaHAvailableCount = 0;
  let colombiaForwardingCount = 0;
  let colombiaOverrideCount = 0;
  for (const wk of subWeeks) {
    const [colRow, boxQtyLive] = await Promise.all([loadColombiaWeekly(wk, orderYear), colombiaBoxQtyByCategory(wk, orderYear)]);
    if (colRow) colombiaSavedCount += 1;
    const gwDef = autoGw.colombia?.[wk];
    const autoDetected = Object.prototype.hasOwnProperty.call(autoFwd.colombiaRest, wk);
    if (autoDetected || colRow?.AirRateUSD != null) colombiaForwardingCount += 1;
    if (colRow?.AirRateUSD != null) colombiaOverrideCount += 1;
    const autoAirTotal = autoFwd.colombiaRest[wk] || 0;
    const effectiveAirTotal = colRow?.AirRateUSD != null ? Number(colRow.AirRateUSD) : autoAirTotal; // 수기 override > 자동감지

    const resolved = resolveColombiaCustomsAllocation({
      orderWeek: wk, orderYear, major, colRow, boxQty: boxQtyLive, gwDef, airTotal: effectiveAirTotal, rates,
    });
    if (resolved.source === HISTORICAL_CUSTOMS_SOURCE) colombiaHistoricalCount += 1;
    else if (resolved.source === 'gw_auto') colombiaGwAutoCount += 1;
    if (resolved.gw > 0) colombiaHAvailableCount += 1;
    colombiaWeekDetails.push({
      orderWeek: wk, source: resolved.source, total: resolved.total, gw: resolved.gw,
      truckActual: resolved.truckActual, truckAuto: resolved.truckAuto, truckSource: resolved.truckSource,
    });
    for (const cat of COLOMBIA_ALLOC_CATEGORIES) { H[cat] += resolved.allocation[cat].H; S[cat] += resolved.allocation[cat].S; }
  }
  const hColombiaSource = colombiaSavedCount === subWeeks.length
    ? 'saved'
    : colombiaHistoricalCount > 0 && (colombiaSavedCount + colombiaHistoricalCount) === subWeeks.length
      ? HISTORICAL_CUSTOMS_SOURCE
      : colombiaHAvailableCount === subWeeks.length
        ? 'gw_auto'
        : colombiaHAvailableCount > 0 ? 'partial'
        : colombiaGwAutoCount > 0 ? 'gw_auto' : 'missing';
  const sColombiaSource = colombiaForwardingCount === 0 ? 'missing' : colombiaForwardingCount === subWeeks.length
    ? (colombiaOverrideCount === subWeeks.length ? 'manual_override' : 'auto')
    : 'partial';
  for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
    HSource[cat] = hColombiaSource;
    SSource[cat] = autoFwd.ledger?.coverageByCategory?.[cat]?.source || sColombiaSource;
  }
  return {
    H, S, rates,
    components: { H: HComponents, colombiaWeeks: colombiaWeekDetails },
    sources: {
      H: HSource,
      S: SSource,
      colombia: {
        expectedWeeks: subWeeks.length,
        customsSavedWeeks: colombiaSavedCount,
        historicalWeeks: colombiaHistoricalCount,
        forwardingDetectedWeeks: colombiaForwardingCount,
      },
      forwardingLedger: autoFwd.ledger,
    },
  };
}
