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
import { COLOMBIA_ALLOC_CATEGORY_KEYS } from './colombiaFlowerClassification.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export const COLOMBIA_ALLOC_CATEGORIES = COLOMBIA_ALLOC_CATEGORY_KEYS;

/** 이 계산에 쓸 단가표 — 전역 단가표 위에 **행 단위 요율 스냅샷**을 덮어쓴다.
 *
 * 행이 저장되거나(BakSangRateApplied) historical snapshot에서 온 경우(TruckRatesApplied 등),
 * 그 행은 저장·확정 당시의 요율로 계산해야 한다. 관리자가 나중에 전역 단가표를 바꿔도 과거
 * 차수의 확정 계산이 조용히 달라지면 안 되기 때문이다(요율 스냅샷 정책).
 * 스냅샷이 없는 항목은 항상 최신 전역값을 그대로 쓴다.
 * DB 의존 없음 — 클라이언트(그외통관비 입력화면 미리보기)와 서버 resolver 양쪽이 재사용한다. */
export function ratesForRow(row, rates) {
  if (!row) return rates;
  const out = { ...rates };
  if (n0(row.BakSangRateApplied) > 0) out.BakSangRate = n0(row.BakSangRateApplied);
  if (n0(row.QuarantinePerItemRateApplied) > 0) out.QuarantinePerItemRate = n0(row.QuarantinePerItemRateApplied);
  const truck = row.TruckRatesApplied;
  if (truck) {
    for (const key of ['Truck1t', 'Truck2_5t', 'Truck5t']) {
      if (n0(truck[key]) > 0) out[key] = n0(truck[key]);
    }
  }
  return out;
}

/** 국가별(수국 포함) 그외통관비 총액 — 엑셀 그외통관비!I35~I45 그대로.
 * 백상창고료·관세는 그대로 더하고, 선율·월드운송료·한국방역(전부 리터럴 1차+2차)은 ÷1.1(공급가) 후 더한다.
 * 베트남 선율만 완성본 22/24/26차와 수식 포함 26차 파일에서 공급가 리터럴로 더하므로 VAT를 재차 제거하지 않는다.
 * 백상 창고료 요율은 row.BakSangRateApplied(저장 시점 스냅샷)가 있으면 그 값을 최우선으로 쓴다 —
 * 나중에 rates.BakSangRate(전역 설정)가 바뀌어도 이미 저장된 과거 행의 계산은 바뀌지 않는다. */
export function computeCountryCustomsTotal(row, rates, category = '') {
  if (!row) return 0;
  const bakSangRate = n0(ratesForRow(row, rates).BakSangRate);
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
  const r = ratesForRow(row, rates);
  const bakSang = n0(row.GW) * n0(r.BakSangRate);
  const truck = n0(row.Truck1t) * n0(r.Truck1t) + n0(row.Truck2_5t) * n0(r.Truck2_5t) + n0(row.Truck5t) * n0(r.Truck5t);
  return bakSang + n0(row.HandlingFee) + n0(row.ItemCount) * n0(r.QuarantinePerItemRate) + truck
    + n0(row.CustomsFee) + n0(row.DisinfectFee) + n0(row.QuarantineDeductFee);
}

/** 콜롬비아 4품목 카테고리별 배분비율 — 무게비율(항상, 그외통관비용)과 CBM비율(포워딩 GW≠CW일 때용) 둘 다 반환.
 * boxQty = { '콜롬비아 장미': qty, ... } (WarehouseDetail 자동집계 또는 수기 override) */
const RATE_KEY_SUFFIX = { '콜롬비아 장미': '콜롬비아장미', '콜롬비아 카네이션': '콜롬비아카네이션', '콜롬비아 알스트로': '콜롬비아알스트로', '콜롬비아 루스커스': '콜롬비아루스커스' };
export function computeColombiaRatios(boxQty, rates) {
  const weights = COLOMBIA_ALLOC_CATEGORIES.map((cat) => n0(boxQty[cat]) * n0(rates[`BoxWeight_${RATE_KEY_SUFFIX[cat]}`]));
  const cbms = COLOMBIA_ALLOC_CATEGORIES.map((cat) => n0(boxQty[cat]) * n0(rates[`BoxCBM_${RATE_KEY_SUFFIX[cat]}`]));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const cSum = cbms.reduce((a, b) => a + b, 0);
  const weightRatio = {}, cbmRatio = {};
  COLOMBIA_ALLOC_CATEGORIES.forEach((cat, i) => {
    weightRatio[cat] = wSum > 0 ? weights[i] / wSum : 0;
    cbmRatio[cat] = cSum > 0 ? cbms[i] / cSum : 0;
  });
  return { weightRatio, cbmRatio };
}

/** 콜롬비아 4품목 카테고리별 {H그외통관비, S포워딩USD} — 반차수 1건 기준(1차 또는 2차 각각 호출 후 합산). */
export function computeColombiaAllocation(colWeeklyRow, boxQty, rates) {
  const total = computeColombiaCustomsTotal(colWeeklyRow, rates);
  const { weightRatio, cbmRatio } = computeColombiaRatios(boxQty, rates);
  const gw = n0(colWeeklyRow?.GW), cw = n0(colWeeklyRow?.CW);
  const useWeight = gw === 0 || cw === 0 || Math.abs(gw - cw) < 0.01; // GW≈CW → 무게기준, 엑셀 IF(L29=L30,...)
  const airTotal = n0(colWeeklyRow?.AirRateUSD);
  const out = {};
  for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
    out[cat] = {
      H: total * weightRatio[cat],                                          // 그외통관비 — 항상 무게비율
      S: airTotal * (useWeight ? weightRatio[cat] : cbmRatio[cat]),         // 포워딩 총액(USD) — GW=CW 여부로 전환
    };
  }
  return out;
}

