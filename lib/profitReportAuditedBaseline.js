// lib/profitReportAuditedBaseline.js — 2026년 22~27차 매출원가 양식(그외통관비) 감사 기준값.
// DB 의존 없는 순수 데이터 모듈. "매출원가 양식 - NN차_재고수정.xlsx"(원본 6개 파일, Downloads 폴더
// read-only 추출)에서 옮겨 적었고, __tests__/fixtures/profit-report-22-27.json(테스트 증거 전용,
// xlsx 원본에서 추출한 카테고리별 H셀 값)과 __tests__/profitReportAuditedBaseline.test.js가 그 값을
// 대조한다. 운영 코드(lib/customsForwarding.js)는 이 모듈만 사용하고 테스트 fixture json을
// import하지 않는다 — fixture가 사라지거나 바뀌어도 이 모듈의 값은 그대로 유지된다.
//
// 적용 범위: AUDITED_BASELINE_YEAR + 아래 표에 있는 대차수뿐이다. 다른 연도의 동일 차수(예: 2025년
// 22~27차)나 표에 없는 차수(28차 이후)에는 절대 적용되지 않는다 — getAudited*() 함수들이 모두
// orderYear 정확 일치를 먼저 검사한다.
//
// 이 값들이 쓰이는 자리(lib/customsForwarding.js):
//  - getAuditedBakSangRate: 국가별/콜롬비아 그외통관비의 백상 창고료 요율. 전역 설정(RATE_DEFAULTS/
//    WebCustomsRateConfig)이 나중에 바뀌어도 22~27차는 이 표의 요율을 그대로 쓴다.
//  - getAuditedCountryH: 국가별(콜롬비아 수국 포함) WebCustomsWeekly 저장행이 전혀 없을 때만 쓰는
//    그외통관비 총액 폴백. 원본 워크북은 GW/관세/선율/월드운송료/방역 개별 구성요소까지 전부
//    read-only로 분석했지만(재추출 불가가 아님), 그 구성요소들이 운영 DB(WebCustomsWeekly)의 입력
//    필드로 저장된 적이 없는 상태라 "저장됐어야 할 값"을 역산해 발명하지 않기로 했다 — 의도적으로
//    검증된 최종 H 합계만 보존한다.
//  - getAuditedColombiaWeekly: 콜롬비아 4품목(카네이션·장미·알스트로·루스커스) 반차수 WebColombiaWeekly
//    저장행이 전혀 없을 때만 쓰는 GW/박스수량/그외통관비 TOTAL(무게배분 전) 폴백.

export const AUDITED_BASELINE_YEAR = '2026';

// 백상 창고료 원가(원/kg) — 22차만 370, 23~27차는 460.
const BAKSANG_RATE_BY_MAJOR = {
  '22': 370,
  '23': 460,
  '24': 460,
  '25': 460,
  '26': 460,
  '27': 460,
};

/** 감사된 백상 창고료 요율. 대상 연도·차수가 아니면 null(호출부가 현재 전역 요율로 대체). */
export function getAuditedBakSangRate(orderYear, major) {
  if (String(orderYear) !== AUDITED_BASELINE_YEAR) return null;
  const rate = BAKSANG_RATE_BY_MAJOR[String(major)];
  return rate == null ? null : rate;
}

// 국가별(콜롬비아 수국 포함) 감사된 그외통관비 총액(H) — "그외통관비" 시트 카테고리별 최종 합계.
// __tests__/fixtures/profit-report-22-27.json의 categories[].cells.H.value와 1:1로 대조됨
// (__tests__/profitReportAuditedBaseline.test.js). 0은 그 주 실제로 구매/입고가 없어 정상적으로
// 0인 값이다(예: 호주 22/25/26차, 베트남 23/25/27차) — 누락이 아니다.
const COUNTRY_H_BY_MAJOR = {
  '22': {
    '콜롬비아 수국': 3199940, '네덜란드': 1178340, '호주': 0, '태국': 315408.7,
    '중국': 2360770, '에콰도르': 876880, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 1176190,
  },
  '23': {
    '콜롬비아 수국': 2000740, '네덜란드': 846870, '호주': 304706, '태국': 355310,
    '중국': 2439290, '에콰도르': 877420, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 0,
  },
  '24': {
    '콜롬비아 수국': 2178780, '네덜란드': 646070, '호주': 450896, '태국': 343360,
    '중국': 2936760, '에콰도르': 802760, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 962770,
  },
  '25': {
    '콜롬비아 수국': 2146540, '네덜란드': 878340, '호주': 0, '태국': 385650,
    '중국': 1271510, '에콰도르': 1255570, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 0,
  },
  '26': {
    '콜롬비아 수국': 2318580, '네덜란드': 857690, '호주': 0, '태국': 334250,
    '중국': 2211960, '에콰도르': 805420, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 1102150,
  },
  '27': {
    '콜롬비아 수국': 2369680, '네덜란드': 654670, '호주': 608410, '태국': 362830,
    '중국': 1675210, '에콰도르': 674370, '미국': 0, '이스라엘': 0, '뉴질랜드': 0,
    '일본': 0, '베트남': 0,
  },
};

/** 국가(콜롬비아 수국 포함) 감사된 H 총액. 대상 연도·차수·카테고리가 아니면 null. */
export function getAuditedCountryH(orderYear, major, category) {
  if (String(orderYear) !== AUDITED_BASELINE_YEAR) return null;
  const row = COUNTRY_H_BY_MAJOR[String(major)];
  if (!row || !Object.prototype.hasOwnProperty.call(row, category)) return null;
  return row[category];
}

// 콜롬비아 4품목(카네이션·장미·알스트로·루스커스) 반차수별 GW(kg)/박스수량/그외통관비 TOTAL —
// "콜롬비아 1차"/"콜롬비아 2차" 시트 원본. TOTAL은 무게비율 배분 전 합계(computeColombiaCustomsTotal
// 결과와 같은 자리)이다. 구성요소(HandlingFee/CustomsFee/DisinfectFee/...)도 원본에서 전부 확인했지만,
// 운영 폴백에는 검증된 TOTAL만 보존해 존재하지 않는 운영 DB 입력행을 만들어내지 않는다. boxQty 순서는 원본 시트 그대로 장미/카네이션/알스트로/
// 루스커스. 각 대차수 TOTAL(1차+2차) 합계는 COUNTRY_H_BY_MAJOR와 별개로
// __tests__/profitReportAuditedBaseline.test.js가 fixture의 콜롬비아 4품목 H 합계와 대조한다.
const COLOMBIA_WEEKLY = {
  '22-01': { gw: 7530, total: 3134100, boxQty: { '콜롬비아 장미': 190, '콜롬비아 카네이션': 505, '콜롬비아 알스트로': 28, '콜롬비아 루스커스': 75 } },
  '22-02': { gw: 553, total: 376610, boxQty: { '콜롬비아 장미': 6, '콜롬비아 카네이션': 44, '콜롬비아 알스트로': 7, '콜롬비아 루스커스': 0 } },
  '23-01': { gw: 6404, total: 3293840, boxQty: { '콜롬비아 장미': 135, '콜롬비아 카네이션': 431, '콜롬비아 알스트로': 24, '콜롬비아 루스커스': 73 } },
  '23-02': { gw: 237, total: 281020, boxQty: { '콜롬비아 장미': 12, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 6, '콜롬비아 루스커스': 0 } },
  '24-01': { gw: 6415, total: 3298900, boxQty: { '콜롬비아 장미': 137, '콜롬비아 카네이션': 429, '콜롬비아 알스트로': 17, '콜롬비아 루스커스': 67 } },
  '24-02': { gw: 542, total: 421320, boxQty: { '콜롬비아 장미': 35, '콜롬비아 카네이션': 20, '콜롬비아 알스트로': 8, '콜롬비아 루스커스': 0 } },
  '25-01': { gw: 6437, total: 3309020, boxQty: { '콜롬비아 장미': 142, '콜롬비아 카네이션': 422, '콜롬비아 알스트로': 26, '콜롬비아 루스커스': 65 } },
  '25-02': { gw: 966, total: 616360, boxQty: { '콜롬비아 장미': 31, '콜롬비아 카네이션': 64, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '26-01': { gw: 6706, total: 3432760, boxQty: { '콜롬비아 장미': 209, '콜롬비아 카네이션': 441, '콜롬비아 알스트로': 16, '콜롬비아 루스커스': 27 } },
  '26-02': { gw: 655, total: 473300, boxQty: { '콜롬비아 장미': 27, '콜롬비아 카네이션': 40, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
  '27-01': { gw: 7020, total: 3577200, boxQty: { '콜롬비아 장미': 193, '콜롬비아 카네이션': 445, '콜롬비아 알스트로': 21, '콜롬비아 루스커스': 59 } },
  '27-02': { gw: 1371, total: 890660, boxQty: { '콜롬비아 장미': 59, '콜롬비아 카네이션': 74, '콜롬비아 알스트로': 12, '콜롬비아 루스커스': 0 } },
};

/** 콜롬비아 4품목 반차수 감사 기준값. 대상 연도·반차수가 아니면 null. */
export function getAuditedColombiaWeekly(orderYear, orderWeek) {
  if (String(orderYear) !== AUDITED_BASELINE_YEAR) return null;
  const row = COLOMBIA_WEEKLY[orderWeek];
  return row || null;
}

/** 감사 기준값이 있는 콜롬비아 반차수 전체 목록(테스트/진단용). */
export function auditedColombiaWeeks() {
  return Object.keys(COLOMBIA_WEEKLY);
}

// 검증용(테스트 전용) — "국가 소계 + 콜롬비아 합계 = 대차수 총액" 그랜드토탈. 프로덕션 계산 경로는
// 이 상수를 읽지 않는다. __tests__/profitReportAuditedBaseline.test.js가 COUNTRY_H_BY_MAJOR/
// COLOMBIA_WEEKLY 합계가 이 값과 정확히 같은지만 대조하는 데 쓴다.
export const AUDITED_GRAND_TOTAL_BY_MAJOR = {
  '22': { countrySubtotal: 9107528.7, colombiaTotal: 3510710, total: 12618238.7 },
  '23': { countrySubtotal: 6824336, colombiaTotal: 3574860, total: 10399196 },
  '24': { countrySubtotal: 8321396, colombiaTotal: 3720220, total: 12041616 },
  '25': { countrySubtotal: 5937610, colombiaTotal: 3925380, total: 9862990 },
  '26': { countrySubtotal: 7630050, colombiaTotal: 3906060, total: 11536110 },
  '27': { countrySubtotal: 6345170, colombiaTotal: 4467860, total: 10813030 },
};
