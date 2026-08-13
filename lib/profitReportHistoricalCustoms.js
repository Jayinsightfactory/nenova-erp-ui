// lib/profitReportHistoricalCustoms.js — 2026년 22~27차 매출원가 양식(원본 xlsx)의 **구성요소 단위**
// historical snapshot. DB 의존 없는 순수 데이터 모듈이며 자동 생성물이다.
//
//   생성기: scripts/extract-profit-report-workbooks.mjs (원본 6개 파일 read-only)
//   증거  : __tests__/fixtures/profit-report-22-27-customs.json (같은 실행에서 함께 생성)
//   seed  : docs/migrations/2026-08-12_web_profit_report_historical_seed.sql (같은 값의 웹 전용 테이블 seed)
//
// ## 왜 "최종 H 합계"가 아니라 구성요소인가
// 이전 구현(lib/profitReportAuditedBaseline.js)은 검증된 **최종 H 합계**만 런타임 폴백으로 넣어,
// 백상 GW·관세·선율·월드운송료·한국방역이라는 실제 원천이 운영 DB에 없다는 사실을 화면에서 숨겼다.
// 원본 워크북에는 그 구성요소가 전부 셀 값으로 존재하므로, 이 모듈은 **원천 그대로**를 담고
// 총액은 프로덕션 공식(computeCountryCustomsTotal/computeColombiaCustomsTotal)으로 재계산한다.
// 따라서 폴백이 적용된 행도 "무엇이 얼마여서 H가 얼마인지"가 화면에 그대로 드러난다.
//
// ## 적용 규칙
// - 연도가 정확히 HISTORICAL_CUSTOMS_YEAR와 같고 표에 있는 대차수일 때만 적용된다(2025년 동일 차수 비오염).
// - 운영 DB(WebCustomsWeekly/WebColombiaWeekly)에 저장행이 있으면 그 행이 항상 우선한다(행 단위).
// - source 태그는 HISTORICAL_CUSTOMS_SOURCE로 노출되어 화면이 "자동/저장값"이 아니라
//   "원본 엑셀 historical snapshot"임을 그대로 표시한다.
// - 백상 창고료 요율은 행마다 BakSangRateApplied로 박혀 있다. 국가 시트는 22~27차 모두 460원/kg이고,
//   콜롬비아 4품목 반차수 시트만 22차 370원/kg·23~27차 460원/kg이다(원본 수식 리터럴 그대로).

export const HISTORICAL_CUSTOMS_YEAR = '2026';
export const HISTORICAL_CUSTOMS_SOURCE = 'excel_historical_snapshot';

// 국가별(콜롬비아 수국 포함) 그외통관비 구성요소 — WebCustomsWeekly 컬럼과 같은 이름/의미.
const COUNTRY_ROWS_BY_MAJOR = {
  '22': {
    '콜롬비아 수국': { GW1: 4157, GW2: 1982, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 662, GW2: 0, Customs1: 603820, Customs2: 0, SunYul1: 198000, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 136, GW2: 0, Customs1: 99848.7, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 703, GW2: 354, Customs1: 1120690, Customs2: 394860, SunYul1: 138600, SunYul2: 69300, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 132, GW2: 0, Customs1: 663160, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 292, GW2: 0, Customs1: 882570, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
  '23': {
    '콜롬비아 수국': { GW1: 2539, GW2: 1130, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 275000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 149, GW2: 571, Customs1: 156990, Customs2: 79680, SunYul1: 79200, SunYul2: 128700, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 128, GW2: 0, Customs1: 143430, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 264.1, GW2: 0, Customs1: 21220, Customs2: 0, SunYul1: 79200, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 819, GW2: 163, Customs1: 1235560, Customs2: 393010, SunYul1: 138600, SunYul2: 69300, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 136, GW2: 0, Customs1: 661860, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
  '24': {
    '콜롬비아 수국': { GW1: 2606, GW2: 1487, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 491, GW2: 0, Customs1: 195210, Customs2: 0, SunYul1: 148500, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 109, GW2: 0, Customs1: 131220, Customs2: 0, SunYul1: 79200, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 647.6, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 475, GW2: 761, Customs1: 810900, Customs2: 1261300, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 119, GW2: 0, Customs1: 595020, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 232, GW2: 0, Customs1: 696750, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
  '25': {
    '콜롬비아 수국': { GW1: 2452, GW2: 1397, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 100, GW2: 443, Customs1: 142050, Customs2: 189510, SunYul1: 69300, SunYul2: 158400, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 117, GW2: 0, Customs1: 135830, Customs2: 0, SunYul1: 116600, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 488, GW2: 225, Customs1: 790530, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 200, GW2: 0, Customs1: 1010570, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
  '26': {
    '콜롬비아 수국': { GW1: 2779, GW2: 1444, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 275000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 192, GW2: 520, Customs1: 0, Customs2: 242170, SunYul1: 69300, SunYul2: 148500, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 108, GW2: 0, Customs1: 131570, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 646, GW2: 201, Customs1: 998650, Customs2: 607690, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 119, GW2: 0, Customs1: 597680, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 270, GW2: 0, Customs1: 818650, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
  '27': {
    '콜롬비아 수국': { GW1: 2847, GW2: 1661, Customs1: 0, Customs2: 0, SunYul1: 69300, SunYul2: 69300, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '네덜란드': { GW1: 0, GW2: 456, Customs1: 219910, Customs2: 0, SunYul1: 148500, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '태국': { GW1: 121, GW2: 0, Customs1: 145170, Customs2: 0, SunYul1: 79200, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '호주': { GW1: 566, GW2: 0, Customs1: 168050, Customs2: 0, SunYul1: 99000, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '미국': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '중국': { GW1: 563, GW2: 371, Customs1: 1092570, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '에콰도르': { GW1: 97, GW2: 0, Customs1: 476750, Customs2: 0, SunYul1: 69300, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '이스라엘': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '뉴질랜드': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '일본': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
    '베트남': { GW1: 0, GW2: 0, Customs1: 0, Customs2: 0, SunYul1: 0, SunYul2: 0, WorldFreight1: 0, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0, BakSangRateApplied: 460 },
  },
};

// 콜롬비아 4품목 반차수 구성요소 — WebColombiaWeekly 컬럼과 같은 이름/의미 + 원본 배분 박스수량.
// Truck1t/Truck2_5t/Truck5t는 자동 추천값이 아니라 그 주에 **실제로 사용한 차량 대수**다.
const COLOMBIA_ROWS_BY_WEEK = {
  '22-01': { row: { GW: 7530, CW: 7530, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 370 }, boxQty: { '콜롬비아 장미': 190, '콜롬비아 카네이션': 505, '콜롬비아 알스트로': 28, '콜롬비아 루스커스': 75 } },
  '22-02': { row: { GW: 553, CW: 553, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 370 }, boxQty: { '콜롬비아 장미': 6, '콜롬비아 카네이션': 44, '콜롬비아 알스트로': 7, '콜롬비아 루스커스': 0 } },
  '23-01': { row: { GW: 6404, CW: 6404, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 135, '콜롬비아 카네이션': 431, '콜롬비아 알스트로': 24, '콜롬비아 루스커스': 73 } },
  '23-02': { row: { GW: 237, CW: 265, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 12, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 6, '콜롬비아 루스커스': 0 } },
  '24-01': { row: { GW: 6415, CW: 6415, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 137, '콜롬비아 카네이션': 429, '콜롬비아 알스트로': 17, '콜롬비아 루스커스': 67 } },
  '24-02': { row: { GW: 542, CW: 659, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 35, '콜롬비아 카네이션': 20, '콜롬비아 알스트로': 8, '콜롬비아 루스커스': 0 } },
  '25-01': { row: { GW: 6437, CW: 6437, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 142, '콜롬비아 카네이션': 422, '콜롬비아 알스트로': 26, '콜롬비아 루스커스': 65 } },
  '25-02': { row: { GW: 966, CW: 966, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 31, '콜롬비아 카네이션': 64, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '26-01': { row: { GW: 6706, CW: 6706, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 209, '콜롬비아 카네이션': 441, '콜롬비아 알스트로': 16, '콜롬비아 루스커스': 27 } },
  '26-02': { row: { GW: 655, CW: 670, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 27, '콜롬비아 카네이션': 40, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '27-01': { row: { GW: 7020, CW: 7020, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 193, '콜롬비아 카네이션': 445, '콜롬비아 알스트로': 21, '콜롬비아 루스커스': 59 } },
  '27-02': { row: { GW: 1371, CW: 1371, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 1, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, BakSangRateApplied: 460 }, boxQty: { '콜롬비아 장미': 59, '콜롬비아 카네이션': 74, '콜롬비아 알스트로': 12, '콜롬비아 루스커스': 0 } },
};

// 본표 R(과세환율) — 통관 신고 시점 관세청 과세환율. 같은 통화라도 신고 주차가 다르면 값이 다르다
// (예: 27차 USD가 콜롬비아 1538.30 / 태국·에콰도르 1548.52). 그래서 통화가 아니라 카테고리 단위로 남긴다.
const TAXABLE_RATES_BY_MAJOR = {
  '22': { '콜롬비아 수국': 1504.04, '콜롬비아 카네이션': 1504.04, '콜롬비아 장미': 1504.04, '콜롬비아 루스커스': 1504.04, '콜롬비아 알스트로': 1504.04, '네덜란드': 1754.12, '태국': 1507.15, '중국': 220.96, '에콰도르': 1507.15, '베트남': 1504.04 },
  '23': { '콜롬비아 수국': 1507.15, '콜롬비아 카네이션': 1507.15, '콜롬비아 장미': 1507.15, '콜롬비아 루스커스': 1507.15, '콜롬비아 알스트로': 1507.15, '네덜란드': 1761.08, '호주': 1079.48, '태국': 1514.68, '중국': 221.96, '에콰도르': 1507.15 },
  '24': { '콜롬비아 수국': 1514.68, '콜롬비아 카네이션': 1514.68, '콜롬비아 장미': 1514.68, '콜롬비아 루스커스': 1514.68, '콜롬비아 알스트로': 1514.68, '네덜란드': 1767.31, '호주': 1083.36, '태국': 1531.46, '중국': 226.09, '에콰도르': 1531.46, '베트남': 1514.68 },
  '25': { '콜롬비아 수국': 1531.46, '콜롬비아 카네이션': 1531.46, '콜롬비아 장미': 1531.46, '콜롬비아 루스커스': 1531.46, '콜롬비아 알스트로': 1531.46, '네덜란드': 1751.87, '태국': 1516.02, '중국': 226.09, '에콰도르': 1516.02 },
  '26': { '콜롬비아 수국': 1516.02, '콜롬비아 카네이션': 1516.02, '콜롬비아 장미': 1516.02, '콜롬비아 루스커스': 1516.02, '콜롬비아 알스트로': 1516.02, '네덜란드': 1753.54, '태국': 1538.3, '중국': 224.27, '에콰도르': 1538.3, '베트남': 1516.02 },
  '27': { '콜롬비아 수국': 1538.3, '콜롬비아 카네이션': 1538.3, '콜롬비아 장미': 1538.3, '콜롬비아 루스커스': 1538.3, '콜롬비아 알스트로': 1538.3, '네덜란드': 1766.5, '호주': 1068.23, '태국': 1548.52, '중국': 226.66, '에콰도르': 1548.52 },
};

const inYear = (orderYear) => String(orderYear) === HISTORICAL_CUSTOMS_YEAR;

/** 국가 1건의 historical 구성요소 행(WebCustomsWeekly 모양). 대상 밖이면 null.
 * WorldFreight{1,2}Manual=1을 붙여 반환한다 — 원본 월드운송료는 그 주에 실제로 청구된 금액이므로
 * 자동 트럭 추천(deriveWorldFreight)이 이 값을 다시 계산해 덮어쓰면 안 된다. */
export function getHistoricalCountryCustomsRow(orderYear, major, category) {
  if (!inYear(orderYear)) return null;
  const row = COUNTRY_ROWS_BY_MAJOR[String(major)]?.[category];
  return row ? { ...row, WorldFreight1Manual: 1, WorldFreight2Manual: 1 } : null;
}

/** 콜롬비아 반차수 1건의 historical 구성요소 행 + 배분 박스수량. 대상 밖이면 null. */
export function getHistoricalColombiaWeekly(orderYear, orderWeek) {
  if (!inYear(orderYear)) return null;
  const entry = COLOMBIA_ROWS_BY_WEEK[String(orderWeek)];
  return entry ? { row: { ...entry.row }, boxQty: { ...entry.boxQty } } : null;
}

/** 카테고리별 historical 과세환율(R). 대상 밖이거나 그 주 구매가 없어 원본이 공란이면 null. */
export function getHistoricalTaxableRate(orderYear, major, category) {
  if (!inYear(orderYear)) return null;
  const rate = TAXABLE_RATES_BY_MAJOR[String(major)]?.[category];
  return rate == null ? null : rate;
}

/** historical snapshot이 있는 대차수 목록(테스트/진단/시드용). */
export function historicalCustomsMajors() {
  return Object.keys(COUNTRY_ROWS_BY_MAJOR);
}

/** historical snapshot이 있는 콜롬비아 반차수 목록(테스트/진단/시드용). */
export function historicalColombiaWeeks() {
  return Object.keys(COLOMBIA_ROWS_BY_WEEK);
}

/** 진단/시드 전용 — 전체 표를 그대로 반환한다(호출부가 변형해도 원본이 바뀌지 않도록 복사본). */
export function historicalCustomsTables() {
  return {
    year: HISTORICAL_CUSTOMS_YEAR,
    countries: JSON.parse(JSON.stringify(COUNTRY_ROWS_BY_MAJOR)),
    colombia: JSON.parse(JSON.stringify(COLOMBIA_ROWS_BY_WEEK)),
    taxableRates: JSON.parse(JSON.stringify(TAXABLE_RATES_BY_MAJOR)),
  };
}
