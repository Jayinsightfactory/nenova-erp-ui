// lib/customsForwardingCalc.js — 그외통관비(H)/콜롬비아 배분 순수 계산식 (DB 의존 없음, 클라이언트 안전).
//
// lib/profitReportCalc.js(화면/엑셀생성 공용)와 같은 이유로 분리됐다: lib/customsForwarding.js는
// 최상단에서 './db.js'(mssql)를 import하므로 브라우저 클라이언트 컴포넌트가 그 모듈을 직접 import하면
// 서버 전용 의존성이 클라이언트 번들에 섞여 들어간다. 이 파일은 순수 계산 함수만 담아
// components/CustomsClearancePanel.js(클라이언트, 수기 편집 중 미리보기 합계)와
// lib/customsForwarding.js(서버, 실계산) 양쪽이 같은 함수 하나만 재사용하게 한다 —
// lib/customsForwarding.js는 이 파일에서 import한 뒤 그대로 재노출(re-export)한다(2026-08-12
// 결함수정: 그외통관비 입력화면이 수기 편집 중에는 저장 전 stale 합계를 보여주던 문제 수정).
import { COUNTRY_SPLIT_GROUPS } from './customsFields.js';
import { COLOMBIA_ALLOC_CATEGORY_KEYS, colombiaAllocCategories, isColombiaHydrangeaPool } from './colombiaFlowerClassification.js';
import { getHistoricalCountryCustomsRow, getHistoricalColombiaWeekly } from './profitReportHistoricalCustoms.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export const COLOMBIA_ALLOC_CATEGORIES = COLOMBIA_ALLOC_CATEGORY_KEYS;

/**
 * 이번 계산에 쓸 백상 창고료 요율을 고른다: 계산 대상 행의 스냅샷(BakSangRateApplied) >
 * historical snapshot 요율(2026 22~27차) > 현재 전역 설정.
 *
 * scope를 반드시 구분한다 — 원본 엑셀에서 **국가 시트는 22~27차 전부 460원/kg**이고,
 * **콜롬비아 4품목 반차수 시트만 22차 370원/kg**이다. 이전 구현은 22차 전체를 370으로 적용해
 * 국가별 백상창고료를 과소계상했다(2026-08-12 결함수정).
 *
 * 반환값은 rates 복사본이며 BakSangRate만 교체한다 — 트럭/검역대행/콜롬비아 박스무게 단가는
 * 항상 최신 전역값을 쓴다. DB 의존 없음(클라이언트 미리보기와 서버 resolver 공용).
 *
 * @param {object} rates      전역 단가표(RATE_DEFAULTS + WebCustomsRateConfig)
 * @param {string|number} orderYear
 * @param {string|number} major   대차수('27')
 * @param {'country'|'colombia'} scope
 */
export function effectiveRatesForWeek(rates, orderYear, major, scope = 'country') {
  const historicalRate = scope === 'colombia'
    ? getHistoricalColombiaWeekly(orderYear, `${String(major).padStart(2, '0')}-01`)?.row?.BakSangRateApplied
    : getHistoricalCountryCustomsRow(orderYear, major, '콜롬비아 수국')?.BakSangRateApplied;
  return historicalRate != null ? { ...rates, BakSangRate: historicalRate } : rates;
}

/** 국가별(수국 포함) 그외통관비 총액 — 엑셀 그외통관비!I35~I45 그대로.
 * 백상창고료·관세는 그대로 더하고, 선율·월드운송료·한국방역(전부 리터럴 1차+2차)은 ÷1.1(공급가) 후 더한다.
 * 베트남 선율만 완성본 22/24/26차와 수식 포함 26차 파일에서 공급가 리터럴로 더하므로 VAT를 재차 제거하지 않는다.
 * 백상 창고료 요율은 row.BakSangRateApplied(저장 시점 스냅샷)가 있으면 그 값을 최우선으로 쓴다 —
 * 나중에 rates.BakSangRate(전역 설정)가 바뀌어도 이미 저장된 과거 행의 계산은 바뀌지 않는다. */
export function computeCountryCustomsTotal(row, rates, category = '') {
  if (!row) return 0;
  const bakSangRate = n0(row.BakSangRateApplied) > 0 ? n0(row.BakSangRateApplied) : n0(rates.BakSangRate);
  const bakSang = (n0(row.GW1) + n0(row.GW2)) * bakSangRate;                 // 그대로(부가세 미분리)
  const splitAmount = (total, parts) => {
    const hasPart = parts.some((field) => Object.prototype.hasOwnProperty.call(row, field));
    return hasPart ? parts.reduce((sum, field) => sum + n0(row[field]), 0) : n0(row[total]);
  };
  const customs = splitAmount('Customs1', COUNTRY_SPLIT_GROUPS[0].parts)
    + splitAmount('Customs2', COUNTRY_SPLIT_GROUPS[1].parts);                // 분할 합계 그대로
  const sunYulGross = splitAmount('SunYul1', COUNTRY_SPLIT_GROUPS[2].parts)
    + splitAmount('SunYul2', COUNTRY_SPLIT_GROUPS[3].parts);
  const sunYul = category === '베트남' ? sunYulGross : sunYulGross / 1.1;
  const worldFreight = (n0(row.WorldFreight1) + n0(row.WorldFreight2)) / 1.1;
  const domesticQuarantine = (n0(row.Quarantine1) + n0(row.Quarantine2)) / 1.1;
  return bakSang + customs + sunYul + worldFreight + domesticQuarantine;
}

/** 콜롬비아 4품목 반차수 TOTAL 그외통관비(=C17, 부가세 무관 합산 — 엑셀은 이 TOTAL을 그대로 무게비율 배분).
 * 백상 창고료 요율은 row.BakSangRateApplied(저장 시점 스냅샷)를 최우선으로 쓴다(computeCountryCustomsTotal과 동일 정책). */
export function computeColombiaCustomsTotal(row, rates) {
  if (!row) return 0;
  const bakSangRate = n0(row.BakSangRateApplied) > 0 ? n0(row.BakSangRateApplied) : n0(rates.BakSangRate);
  const bakSang = n0(row.GW) * bakSangRate;
  const truck = n0(row.Truck1t) * n0(rates.Truck1t) + n0(row.Truck2_5t) * n0(rates.Truck2_5t) + n0(row.Truck5t) * n0(rates.Truck5t);
  return bakSang + n0(row.HandlingFee) + n0(row.ItemCount) * n0(rates.QuarantinePerItemRate) + truck
    + n0(row.CustomsFee) + n0(row.DisinfectFee) + n0(row.QuarantineDeductFee);
}

/** 콜롬비아 배분비율 — 무게와 CBM. 콜카장알루수국을 켠 경우에만 수국을 풀에 포함한다. */
const RATE_KEY_SUFFIX = {
  '콜롬비아 수국': '콜롬비아수국',
  '콜롬비아 장미': '콜롬비아장미',
  '콜롬비아 카네이션': '콜롬비아카네이션',
  '콜롬비아 알스트로': '콜롬비아알스트로',
  '콜롬비아 루스커스': '콜롬비아루스커스',
};

export function computeColombiaRatios(boxQty, rates, options = {}) {
  const includeHydrangea = options.includeHydrangea === true;
  const categories = colombiaAllocCategories({ includeHydrangea });
  const weights = categories.map((cat) => n0(boxQty?.[cat]) * n0(rates[`BoxWeight_${RATE_KEY_SUFFIX[cat]}`]));
  const cbms = categories.map((cat) => n0(boxQty?.[cat]) * n0(rates[`BoxCBM_${RATE_KEY_SUFFIX[cat]}`]));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const cSum = cbms.reduce((a, b) => a + b, 0);
  const weightRatio = {}, cbmRatio = {};
  categories.forEach((cat, i) => {
    weightRatio[cat] = wSum > 0 ? weights[i] / wSum : 0;
    cbmRatio[cat] = cSum > 0 ? cbms[i] / cSum : 0;
  });
  return { weightRatio, cbmRatio, categories };
}

/**
 * 항공료 배분 기준 — 원본 콜롬비아 반차수 시트 `IF(CW=GW, 무게비율, CBM비율)` 그대로.
 * 과금중량과 총중량이 정확히 같을 때만 무게비율이고, 다르면(크든 작든) CBM비율이다.
 * 한쪽이 비어 있으면 비교할 수 없으므로 무게비율로 둔다.
 *
 * 그외통관비 배분은 이 판정을 쓰지 않는다 — 원본은 항상 무게비율 고정이다(H21=$C$17*M37).
 */
export function colombiaUsesWeightRatio(gw, cw) {
  const gross = n0(gw);
  const chargeable = n0(cw);
  if (gross === 0 || chargeable === 0) return true;
  return Math.abs(chargeable - gross) <= 0.01;
}

/** 화면 배지용 — 항공료 배분 기준을 그대로 문구로 만든다. */
export function colombiaRatioMode(gw, cw) {
  const useWeight = colombiaUsesWeightRatio(gw, cw);
  const g = Math.round(n0(gw) * 10) / 10;
  const c = Math.round(n0(cw) * 10) / 10;
  if (g === 0 && c === 0) return { useWeight: true, label: '총중량/과금중량 없음 → 항공료 무게비율' };
  if (useWeight) {
    if (c === 0 || g === 0) return { useWeight: true, label: `총중량 ${g} / 과금중량 ${c} → 항공료 무게비율` };
    return { useWeight: true, label: `과금중량 ${c} = 총중량 ${g} → 항공료 무게비율` };
  }
  return { useWeight: false, label: `과금중량 ${c} ≠ 총중량 ${g} → 항공료 CBM비율` };
}

/**
 * 콜롬비아 카테고리별 {H 그외통관비, S 항공료(USD)} — 반차수 1건 기준(1차/2차 각각 호출 후 합산).
 *
 *   그외통관비 H : 항상 무게비율 (원본 `H21=$C$17*M37`)
 *   항공료     S : 과금중량=총중량이면 무게비율, 다르면 CBM비율 (원본 `F21=IF(CW=GW,항공료*M37,항공료*R37)`)
 */
export function computeColombiaAllocation(colWeeklyRow, boxQty, rates) {
  const total = computeColombiaCustomsTotal(colWeeklyRow, rates);
  const includeHydrangea = isColombiaHydrangeaPool(colWeeklyRow?.IncludeHydrangea)
    || isColombiaHydrangeaPool(colWeeklyRow?.allocPool);
  const { weightRatio, cbmRatio, categories } = computeColombiaRatios(boxQty, rates, { includeHydrangea });
  const airUsesWeight = colombiaUsesWeightRatio(colWeeklyRow?.GW, colWeeklyRow?.CW);
  const airRatio = airUsesWeight ? weightRatio : cbmRatio;
  const airTotal = n0(colWeeklyRow?.AirRateUSD);
  const out = {};
  for (const cat of categories) {
    out[cat] = {
      H: total * n0(weightRatio[cat]),
      S: airTotal * n0(airRatio[cat]),
    };
  }
  return out;
}

/** 콜롬비아 카테고리별 {H,S} — 구성요소 없이 검증된 TOTAL을 무게비율로 배분(역사 snapshot 전용). */
export function computeColombiaAllocationFromTotal(total, airTotal, boxQty, rates) {
  const { weightRatio, categories } = computeColombiaRatios(boxQty, rates);
  const out = {};
  for (const cat of categories) {
    out[cat] = { H: n0(total) * n0(weightRatio[cat]), S: n0(airTotal) * n0(weightRatio[cat]) };
  }
  return out;
}
