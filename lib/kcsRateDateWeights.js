// lib/kcsRateDateWeights.js — 관세청(KCS) 주간 과세환율 조회용 (입고일 우선순위, TPrice 가중치) 원장.
//
// 목적: 특정 OrderYear+대차수(MajorWeek) 구간의 WarehouseMaster/WarehouseDetail 입고 라인을
// 통화(currency)+카테고리(category)별로 묶어, 그 통화·카테고리가 실제 입고된 날짜들의 목록과
// 각 날짜의 가중치(그 날짜에 입고된 라인의 TPrice 합)를 돌려준다. 호출자는 이 날짜 목록으로
// 관세청 고시 주간 과세환율(날짜별 1개)을 조회한 뒤, weightedRateFromDatePoints()로
// TPrice 가중평균 환율을 계산한다.
//
// 관세청 자동조회 기준일은 WarehouseMaster.InputDate를 최우선으로 사용한다. ArrivalDtm/UploadDtm은
// 실제 수입신고일이라는 근거가 없으므로 대체값으로 쓰지 않는다. 다만 2026년 22~28차 원본 workbook
// 전수 대조에서 반복 규칙이 확인되고 사용자가 확정한 카테고리는 아래 명시적 schedule registry로만
// 보완한다. 현재 등록된 규칙은 호주(AUD) 하나이며, 차수 NN의 과세환율 적용 주간은 ISO NN주 월요일이다
// (23차 2026-06-01, 24차 2026-06-08, 27차 2026-06-29). 실제 InputDate가 있으면 schedule은 사용하지
// 않는다. registry에 없는 국가/화종은 기존처럼 date:null 진단행으로 남겨 자동 적용을 차단한다.
//
// 스코프는 lib/profitReport.js purchaseByCategory 등과 동일한 패턴
// (`wm.OrderWeek LIKE @pfx AND ISNULL(wm.OrderYear,'') = @yr AND ISNULL(wm.isDeleted,0)=0`)이며,
// 절대 OrderWeek 만으로 필터링하지 않는다(OrderYear 항상 별도 파라미터, 이 저장소의 핵심 불변식).
//
// 카테고리 분류/필터는 lib/profitReport.js가 export하는 단일 진실 소스를 그대로 재사용한다
// (CASE_CATEGORY, stockablePurchaseItemSql, currencyCodeForCategory) — 이 파일에서 새로 만들거나
// 복제하지 않는다. WarehouseMaster/WarehouseDetail에는 통화 컬럼 자체가 없으므로, 통화는 항상
// 카테고리→통화 매핑(currencyCodeForCategory)으로 추정한다(lib/profitReport.js 의 Q 구매금액,
// 관세청 신고환율 관련 다른 조회들과 동일 관례).
//
// DB 접근(loadWarehouseDateWeights)과 순수 계산(weightedRateFromDatePoints/mapCategoryDateRowsToWeights)을
// 분리해, 후자는 DB 없이 단위테스트할 수 있게 한다.
//
// DB 쿼리는 OrderYear+OrderWeek 범위와 InputDate를 함께 읽을 뿐 스키마를 만들거나 수정하지 않는다.
import { query, sql } from './db.js';
import { CASE_CATEGORY, stockablePurchaseItemSql, currencyCodeForCategory } from './profitReport.js';
import { EXTRA_CATEGORY } from './profitReportClassification.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export const DECLARATION_DATE_SOURCE = Object.freeze({
  WAREHOUSE_INPUT_DATE: 'warehouse_input_date',
  CATEGORY_SCHEDULE: 'category_schedule',
  MISSING: 'missing',
});

// 원본 workbook에서 반복성과 통화가 모두 확인되고 사용자가 확정한 규칙만 등록한다.
// 중국 24차처럼 과거 예외가 있는 카테고리는 여기에 넣지 않는다.
export const CATEGORY_DECLARATION_DATE_SCHEDULES = Object.freeze({
  호주: Object.freeze({
    currency: 'AUD',
    isoWeekOffset: 0,
    scheduleId: 'AUSTRALIA_AUD_MAJOR_ISO_WEEK_MONDAY_V1',
    evidenceWeeks: Object.freeze(['2026-23', '2026-24', '2026-27']),
  }),
});

/** ISO 주차의 월요일을 YYYY-MM-DD로 반환한다. UTC만 사용해 서버 시간대에 따른 하루 이동을 막는다. */
export function isoWeekMonday(orderYear, isoWeek) {
  const year = Number(orderYear);
  const week = Number(isoWeek);
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || !Number.isInteger(week) || week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoDay = jan4.getUTCDay() || 7;
  const monday = new Date(Date.UTC(year, 0, 4 - jan4IsoDay + 1 + ((week - 1) * 7)));
  return monday.toISOString().slice(0, 10);
}

/** 실제 InputDate가 없을 때만 사용할 수 있는 카테고리별 신고일 일정. 등록되지 않은 항목은 null. */
export function scheduledDeclarationDate({ orderYear, major, category, currency }) {
  const rule = CATEGORY_DECLARATION_DATE_SCHEDULES[category];
  if (!rule || rule.currency !== currency) return null;
  const date = isoWeekMonday(orderYear, Number(major) + Number(rule.isoWeekOffset || 0));
  if (!date) return null;
  return {
    date,
    source: DECLARATION_DATE_SOURCE.CATEGORY_SCHEDULE,
    scheduleId: rule.scheduleId,
    evidenceWeeks: [...rule.evidenceWeeks],
  };
}

/** SQL DATE(또는 DATETIME) 값을 'YYYY-MM-DD' 키로 변환 — 로컬 타임존 변환으로 하루 밀리는 것을
 * 방지하기 위해 UTC 게터만 사용한다(CLAUDE.md Date 자정/ISOString 주의 규칙과 동일한 이유). */
function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

/**
 * 순수 함수(DB 의존 없음) — SQL이 이미 (date, category)별로 그룹핑/합산한 원시 행을 받아
 * {category, currency, date, weight} 목록으로 다듬는다. 카테고리가 '기타(미분류)'거나
 * currencyCodeForCategory가 통화를 확정하지 못하면(공제/미분류) 그 행은 건너뛴다 — 통화가
 * 불확실한 값을 특정 통화 버킷에 잘못 합산하지 않기 위함이다.
 * loadWarehouseDateWeights()의 후처리 로직을 독립적으로 테스트할 수 있게 분리했다.
 *
 * @param {Array<{Category:string, ResolvedDate:*, Weight:number}>} rawRows
 * @param {{orderYear?:string|number, major?:string|number}} context
 */
export function mapCategoryDateRowsToWeights(rawRows, context = {}) {
  const out = [];
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const category = row?.Category;
    if (!category || category === EXTRA_CATEGORY) continue;
    const weight = n0(row?.Weight);
    if (weight <= 0) continue;
    const currency = currencyCodeForCategory(category);
    if (!currency) continue;
    const inputDate = toDateKey(row?.ResolvedDate);
    const scheduled = inputDate ? null : scheduledDeclarationDate({
      orderYear: context.orderYear,
      major: context.major,
      category,
      currency,
    });
    const date = inputDate || scheduled?.date || null;
    // InputDate가 없고 승인된 일정도 없는 상품 매입은 버리지 않는다. date:null로 남겨 상위 KCS
    // 오케스트레이터가 카테고리 전체를 자동 적용 불가로 판정한다(일부 날짜만 평균하는 오류 방지).
    out.push({
      category,
      currency,
      date,
      weight,
      dateSource: inputDate
        ? DECLARATION_DATE_SOURCE.WAREHOUSE_INPUT_DATE
        : (scheduled?.source || DECLARATION_DATE_SOURCE.MISSING),
      scheduleId: scheduled?.scheduleId || null,
      missingDeclarationDate: !date,
    });
  }
  return out.sort((a, b) =>
    a.category.localeCompare(b.category, 'ko') || a.currency.localeCompare(b.currency) || String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * DB 조회 — 주어진 OrderYear+대차수(MajorWeek) 구간의 WarehouseDetail 라인을 읽어
 * (date, category, currency) 별 TPrice 가중치 목록으로 묶어 반환한다.
 * 항상 OrderYear+OrderWeek(LIKE 'major-%') 둘 다로 스코프를 좁힌다 — 무제한 스캔 금지.
 * 카테고리 분류는 lib/profitReport.js#CASE_CATEGORY(SQL, export됨)를 그대로 재사용하고,
 * 무게 placeholder/비재고 비용행 제외는 lib/profitReport.js#stockablePurchaseItemSql를 재사용한다
 * (Q 구매금액·관세청 신고환율 가중평균과 동일한 "상품 매입" 기준 — 이 두 조건을 새로 만들지 않는다).
 *
 * @param {string|number} orderYear
 * @param {string|number} major  대차수 (예: '28')
 * @returns {Promise<Array<{category:string, currency:string, date:string, weight:number}>>}
 */
export async function loadWarehouseDateWeights(orderYear, major) {
  // KCS 자동조회는 사용자가 명시한 WarehouseMaster.InputDate만 사용한다. ArrivalDtm/UploadDtm은
  // 입고·업로드 시각일 뿐 수입신고일 근거가 아니므로 자동 환율 기준으로 대체하지 않는다.
  const dateExpr = 'wm.InputDate';
  // InputDate 는 DATETIME 성격이라 시각(시:분:초)까지 다를 수 있다.
  // 시각까지 그룹핑하면 같은 날 여러 번 입고/업로드된 라인이 서로 다른 "날짜"로 쪼개져 관세청
  // 주간 과세환율 조회 단위(달력일)와 어긋난다 — 반드시 DATE로 자른 값으로 그룹핑한다.
  const dateOnlyExpr = `CAST(${dateExpr} AS DATE)`;
  const result = await query(
    `SELECT ${CASE_CATEGORY} AS Category,
            ${dateOnlyExpr} AS ResolvedDate,
            SUM(CAST(wd.TPrice AS FLOAT)) AS Weight
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey = p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx
        AND ISNULL(wm.OrderYear, '') = @yr
        AND ISNULL(wm.isDeleted, 0) = 0
        AND ISNULL(wd.TPrice, 0) > 0
        AND ${stockablePurchaseItemSql('p')}
      GROUP BY ${CASE_CATEGORY}, ${dateOnlyExpr}`,
    {
      pfx: { type: sql.NVarChar, value: `${major}-%` },
      yr: { type: sql.NVarChar, value: String(orderYear) },
    },
  );
  return mapCategoryDateRowsToWeights(result.recordset || [], { orderYear, major });
}

/**
 * 순수 함수(DB 의존 없음) — (date, weight) 목록과 날짜→관세청 고시환율 맵을 받아
 * TPrice 가중평균 환율을 계산한다. 특정 카테고리+통화 하나에 대해 호출한다.
 *
 * @param {Array<{date:string, weight:number}>} datePoints  loadWarehouseDateWeights() 결과 중
 *   같은 category+currency 항목들 (또는 임의의 date/weight 목록)
 * @param {Map<string,number>|Object<string,number>} rateByDate  날짜('YYYY-MM-DD') → 관세청 고시환율
 * @returns {number|null}  가중평균 환율. 유효한 가중치가 하나도 없으면 null.
 */
export function weightedRateFromDatePoints(datePoints, rateByDate) {
  if (!Array.isArray(datePoints) || !datePoints.length) return null;
  const getRate = (date) => {
    if (rateByDate instanceof Map) return rateByDate.get(date);
    if (rateByDate && typeof rateByDate === 'object') return rateByDate[date];
    return null;
  };
  let weightSum = 0;
  let weightedRateSum = 0;
  for (const point of datePoints) {
    const date = point?.date;
    const weight = n0(point?.weight);
    if (!date || weight <= 0) continue;
    const rateRaw = getRate(date);
    if (rateRaw == null || Number.isNaN(Number(rateRaw))) continue;
    const rate = Number(rateRaw);
    weightSum += weight;
    weightedRateSum += weight * rate;
  }
  if (weightSum <= 0) return null;
  return weightedRateSum / weightSum;
}
