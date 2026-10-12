// lib/profitReportHistoricalCustoms.js — 2026년 22~27차 그외통관비(H) **원천 구성요소** historical snapshot.
//
// 2026-08-12 재설계 배경(이전 lib/profitReportAuditedBaseline.js 대체):
//   이전 모듈은 국가별 H의 "최종 합계"만 런타임 폴백으로 갖고 있었다. 그러면 화면에 보이는 H가
//   맞더라도 그 값을 만드는 원천(백상 GW·관세·선율·월드운송료·방역)이 운영 DB에 없다는 사실이
//   숨겨지고, 감사 테스트도 "하드코딩 합계 == 하드코딩 합계"를 비교하는 자기증명이 된다.
//   원본 워크북("매출원가 양식 - NN차_재고수정.xlsx")의 `그외통관비` / `콜롬비아 1차·2차` 시트에는
//   구성요소가 전부 그대로 들어 있으므로, 이 모듈은 그 **구성요소**를 스냅샷하고 최종 H는
//   computeCountryCustomsTotal()/computeColombiaCustomsTotal()이 원본 공식으로 계산한다.
//   => 합계를 하드코딩하지 않으므로 공식이 깨지면 테스트가 실제로 실패한다.
//
// 성격: 이 값들은 자동 계산값이 아니라 **과거 확정 보고서의 원천 스냅샷**이다. 화면 source 태그는
//   'historical_snapshot'으로 표시해 "자동값"으로 오인되지 않게 한다.
//   운영 DB(WebCustomsWeekly/WebColombiaWeekly)에 실제 저장행이 있으면 그 행이 언제나 우선한다.
//   docs/migrations/2026-08-12_profit_report_historical_customs_seed.sql 로 같은 값을 웹 전용
//   테이블에 물리적으로 seed 할 수도 있다(그 경우 이 모듈은 자연히 쓰이지 않는다).
//
// 적용 범위: HISTORICAL_SNAPSHOT_YEAR + 아래 표의 대차수/반차수뿐. 다른 연도(예: 2025년 22~27차)나
//   28차 이후에는 절대 적용되지 않는다 — 모든 조회 함수가 orderYear 정확 일치를 먼저 검사한다.
//
// 근거: __tests__/fixtures/profit-report-22-27-full.json (scripts/extract-profit-workbook-fixture.mjs로
//   원본 xlsx에서 read-only 추출). __tests__/profitReportHistoricalCustoms.test.js가 이 모듈의
//   구성요소 → 원본 공식 → 원본 H 셀값을 1:1 대조한다.

export const HISTORICAL_SNAPSHOT_YEAR = '2026';
export const HISTORICAL_SOURCE_TAG = 'historical_snapshot';

// 원본 워크북 22~27차 전부 동일했던 월드운송료/국내운송 트럭 단가(그외통관비!N20:O22, 콜롬비아!H5:H7).
// 저장 시점 요율 스냅샷으로 함께 박제해, 나중에 전역 단가표가 바뀌어도 과거 차수 계산이 흔들리지 않게 한다.
const HISTORICAL_TRUCK_RATES = { Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000 };
// 콜롬비아 검역대행수수료 품목당 단가(콜롬비아!C12 = 품목수 × 10000).
const HISTORICAL_QUARANTINE_PER_ITEM = 10000;

// ── 국가별(콜롬비아 수국 포함) 그외통관비 구성요소 — `그외통관비` 시트
//    GW1/GW2  : 백상 창고료 대상 Gross Weight(kg), 1차/2차 (C·D 5~15행)
//    Customs* : 관세 원화 리터럴 (I·J 5~15행)          — 공급가액 = 금액 그대로
//    SunYul*  : 선율 원화 리터럴 (C·D 20~30행)          — 공급가액 = ÷1.1 (베트남만 예외로 그대로)
//    WorldFreight* : 월드운송료 원화 리터럴 (I·J 20~30행) — 공급가액 = ÷1.1. **실제 청구액**이므로
//                    자동 트럭 추천으로 덮어쓰지 않는다(Manual 플래그로 보존).
//    Quarantine*   : 한국방역 원화 리터럴 (C·D 35~45행)  — 공급가액 = ÷1.1
//    비어 있는 값(0)은 그 주에 실제로 그 항목 청구가 없었다는 뜻이다(누락이 아님).
const COUNTRY_BY_MAJOR = {
  '22': {
    '콜롬비아 수국': { GW1: 4157, GW2: 1982, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000 },
    '네덜란드': { GW1: 662, Customs1: 603820, SunYul1: 198000, WorldFreight1: 99000 },
    '태국': { GW1: 136, Customs1: 99848.7, SunYul1: 69300, WorldFreight1: 99000 },
    '호주': {},
    '미국': {},
    '중국': { GW1: 703, GW2: 354, Customs1: 1120690, Customs2: 394860, SunYul1: 138600, SunYul2: 69300, WorldFreight1: 187000 },
    '에콰도르': { GW1: 132, Customs1: 663160, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': { GW1: 292, Customs1: 882570, SunYul1: 69300, WorldFreight1: 99000 },
  },
  '23': {
    '콜롬비아 수국': { GW1: 2539, GW2: 1130, SunYul1: 69300, WorldFreight1: 275000 },
    '네덜란드': { GW1: 149, GW2: 571, Customs1: 156990, Customs2: 79680, SunYul1: 79200, SunYul2: 128700, WorldFreight1: 99000 },
    '태국': { GW1: 128, Customs1: 143430, SunYul1: 69300, WorldFreight1: 99000 },
    '호주': { GW1: 264.1, Customs1: 21220, SunYul1: 79200, WorldFreight1: 99000 },
    '미국': {},
    '중국': { GW1: 819, GW2: 163, Customs1: 1235560, Customs2: 393010, SunYul1: 138600, SunYul2: 69300, WorldFreight1: 187000 },
    '에콰도르': { GW1: 136, Customs1: 661860, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': {},
  },
  '24': {
    '콜롬비아 수국': { GW1: 2606, GW2: 1487, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000 },
    '네덜란드': { GW1: 491, Customs1: 195210, SunYul1: 148500, WorldFreight1: 99000 },
    '태국': { GW1: 109, Customs1: 131220, SunYul1: 79200, WorldFreight1: 99000 },
    '호주': { GW1: 647.6, SunYul1: 69300, WorldFreight1: 99000 },
    '미국': {},
    '중국': { GW1: 475, GW2: 761, Customs1: 810900, Customs2: 1261300, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000 },
    '에콰도르': { GW1: 119, Customs1: 595020, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': { GW1: 232, Customs1: 696750, SunYul1: 69300, WorldFreight1: 99000 },
  },
  '25': {
    '콜롬비아 수국': { GW1: 2452, GW2: 1397, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000 },
    '네덜란드': { GW1: 100, GW2: 443, Customs1: 142050, Customs2: 189510, SunYul1: 69300, SunYul2: 158400, WorldFreight1: 99000 },
    '태국': { GW1: 117, Customs1: 135830, SunYul1: 116600, WorldFreight1: 99000 },
    '호주': {},
    '미국': {},
    '중국': { GW1: 488, GW2: 225, Customs1: 790530, SunYul1: 69300, WorldFreight1: 99000 },
    '에콰도르': { GW1: 200, Customs1: 1010570, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': {},
  },
  '26': {
    '콜롬비아 수국': { GW1: 2779, GW2: 1444, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000 },
    '네덜란드': { GW1: 192, GW2: 520, Customs2: 242170, SunYul1: 69300, SunYul2: 148500, WorldFreight1: 99000 },
    '태국': { GW1: 108, Customs1: 131570, SunYul1: 69300, WorldFreight1: 99000 },
    '호주': {},
    '미국': {},
    '중국': { GW1: 646, GW2: 201, Customs1: 998650, Customs2: 607690, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 99000 },
    '에콰도르': { GW1: 119, Customs1: 597680, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': { GW1: 270, Customs1: 818650, SunYul1: 69300, WorldFreight1: 99000 },
  },
  '27': {
    '콜롬비아 수국': { GW1: 2847, GW2: 1661, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000 },
    '네덜란드': { GW2: 456, Customs1: 219910, SunYul1: 148500, WorldFreight1: 99000 },
    '태국': { GW1: 121, Customs1: 145170, SunYul1: 79200, WorldFreight1: 99000 },
    '호주': { GW1: 566, Customs1: 168050, SunYul1: 99000, WorldFreight1: 99000 },
    '미국': {},
    '중국': { GW1: 563, GW2: 371, Customs1: 1092570, SunYul1: 69300, WorldFreight1: 99000 },
    '에콰도르': { GW1: 97, Customs1: 476750, SunYul1: 69300, WorldFreight1: 99000 },
    '이스라엘': {},
    '뉴질랜드': {},
    '일본': {},
    '베트남': {},
  },
};

// 백상 창고료 요율은 **시트 단위로 다르다**. 22차 원본에서 `그외통관비` 시트(C3)는 460원/kg인데
// `콜롬비아 1차·2차` 시트(C10 수식)는 370원/kg이다. 연도·차수 하나의 상수로 뭉뚱그리면
// 22차 국가별 H가 어긋난다(이전 구현의 결함).
const COUNTRY_BAKSANG_RATE_BY_MAJOR = { '22': 460, '23': 460, '24': 460, '25': 460, '26': 460, '27': 460 };

// ── 콜롬비아 4품목 반차수 구성요소 — `콜롬비아 1차`/`콜롬비아 2차` 시트
//    TOTAL = GW×백상요율 + HandlingFee(통관수수료 33,000) + ItemCount×10,000(검역대행)
//            + Σ(트럭대수×트럭단가) + CustomsFee(관세료) + DisinfectFee(소독비용) + QuarantineDeductFee(검역비용)
//    boxQty/AirRateUSD는 무게배분 비율과 포워딩(S) 배분의 원천이다.
const COLOMBIA_BY_WEEK = {
  '22-01': { bakSangRate: 370, GW: 7530, CW: 7530, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 20794.5, boxQty: { '콜롬비아 장미': 190, '콜롬비아 카네이션': 505, '콜롬비아 알스트로': 28, '콜롬비아 루스커스': 75 } },
  '22-02': { bakSangRate: 370, GW: 553, CW: 553, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, AirRateUSD: 1544.92, boxQty: { '콜롬비아 장미': 6, '콜롬비아 카네이션': 44, '콜롬비아 알스트로': 7, '콜롬비아 루스커스': 0 } },
  '23-01': { bakSangRate: 460, GW: 6404, CW: 6404, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 17698, boxQty: { '콜롬비아 장미': 135, '콜롬비아 카네이션': 431, '콜롬비아 알스트로': 24, '콜롬비아 루스커스': 73 } },
  '23-02': { bakSangRate: 460, GW: 237, CW: 265, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, AirRateUSD: 811.1, boxQty: { '콜롬비아 장미': 12, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 6, '콜롬비아 루스커스': 0 } },
  '24-01': { bakSangRate: 460, GW: 6415, CW: 6415, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 17728.25, boxQty: { '콜롬비아 장미': 137, '콜롬비아 카네이션': 429, '콜롬비아 알스트로': 17, '콜롬비아 루스커스': 67 } },
  '24-02': { bakSangRate: 460, GW: 542, CW: 659, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, AirRateUSD: 1882.3, boxQty: { '콜롬비아 장미': 35, '콜롬비아 카네이션': 20, '콜롬비아 알스트로': 8, '콜롬비아 루스커스': 0 } },
  '25-01': { bakSangRate: 460, GW: 6437, CW: 6437, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 17464.9, boxQty: { '콜롬비아 장미': 142, '콜롬비아 카네이션': 422, '콜롬비아 알스트로': 26, '콜롬비아 루스커스': 65 } },
  '25-02': { bakSangRate: 460, GW: 966, CW: 966, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, AirRateUSD: 2759.5, boxQty: { '콜롬비아 장미': 31, '콜롬비아 카네이션': 64, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '26-01': { bakSangRate: 460, GW: 6706, CW: 6706, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 18191.2, boxQty: { '콜롬비아 장미': 209, '콜롬비아 카네이션': 441, '콜롬비아 알스트로': 16, '콜롬비아 루스커스': 27 } },
  '26-02': { bakSangRate: 460, GW: 655, CW: 670, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, AirRateUSD: 1915.5, boxQty: { '콜롬비아 장미': 27, '콜롬비아 카네이션': 40, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '27-01': { bakSangRate: 460, GW: 7020, CW: 7020, HandlingFee: 33000, ItemCount: 4, Truck5t: 1, AirRateUSD: 19039, boxQty: { '콜롬비아 장미': 193, '콜롬비아 카네이션': 445, '콜롬비아 알스트로': 21, '콜롬비아 루스커스': 59 } },
  '27-02': { bakSangRate: 460, GW: 1371, CW: 1371, HandlingFee: 33000, ItemCount: 4, Truck2_5t: 1, AirRateUSD: 4002.35, boxQty: { '콜롬비아 장미': 59, '콜롬비아 카네이션': 74, '콜롬비아 알스트로': 12, '콜롬비아 루스커스': 0 } },
};

const isTargetYear = (orderYear) => String(orderYear) === HISTORICAL_SNAPSHOT_YEAR;

/** 국가별(콜롬비아 수국 포함) historical snapshot 행. 대상 연도·차수·카테고리가 아니면 null.
 * 반환 행은 computeCountryCustomsTotal()에 그대로 넣을 수 있는 형태이며,
 * - BakSangRateApplied: 원본 시트의 백상 요율 스냅샷(전역 요율 변경에 영향받지 않음)
 * - WorldFreight{1,2}Manual = 1: 원본에 기록된 **실제 청구 운송료**이므로 자동 트럭 추천으로 대체 금지 */
export function getHistoricalCountryCustoms(orderYear, major, category) {
  if (!isTargetYear(orderYear)) return null;
  const week = COUNTRY_BY_MAJOR[String(major)];
  if (!week || !Object.prototype.hasOwnProperty.call(week, category)) return null;
  const base = week[category];
  return {
    GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0,
    WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0,
    ...base,
    BakSangRateApplied: COUNTRY_BAKSANG_RATE_BY_MAJOR[String(major)],
    WorldFreight1Manual: 1,
    WorldFreight2Manual: 1,
    TruckRatesApplied: { ...HISTORICAL_TRUCK_RATES },
  };
}

/** 콜롬비아 4품목 반차수 historical snapshot. 대상 연도·반차수가 아니면 null.
 * 반환 행은 computeColombiaCustomsTotal()/computeColombiaAllocation()에 그대로 넣을 수 있다. */
export function getHistoricalColombiaWeekly(orderYear, orderWeek) {
  if (!isTargetYear(orderYear)) return null;
  const base = COLOMBIA_BY_WEEK[String(orderWeek)];
  if (!base) return null;
  const { bakSangRate, boxQty, ...rest } = base;
  return {
    row: {
      GW: 0, CW: 0, HandlingFee: 0, ItemCount: 0, Truck1t: 0, Truck2_5t: 0, Truck5t: 0,
      CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, AirRateUSD: 0,
      ...rest,
      BakSangRateApplied: bakSangRate,
      TruckRatesApplied: { ...HISTORICAL_TRUCK_RATES },
      QuarantinePerItemRateApplied: HISTORICAL_QUARANTINE_PER_ITEM,
    },
    boxQty: { ...boxQty },
  };
}

/** historical snapshot이 존재하는 대차수 목록(테스트/진단/seed 생성용). */
export function historicalCountryMajors() {
  return Object.keys(COUNTRY_BY_MAJOR);
}
/** historical snapshot이 존재하는 콜롬비아 반차수 목록(테스트/진단/seed 생성용). */
export function historicalColombiaWeeks() {
  return Object.keys(COLOMBIA_BY_WEEK);
}
/** 대차수에 정의된 국가 카테고리 목록(테스트/seed 생성용). */
export function historicalCountryCategories(major) {
  return Object.keys(COUNTRY_BY_MAJOR[String(major)] || {});
}
