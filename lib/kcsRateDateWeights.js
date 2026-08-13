// lib/kcsRateDateWeights.js — 관세청(KCS) 주간 과세환율 조회용 (입고일 우선순위, TPrice 가중치) 원장.
//
// 목적: 특정 OrderYear+대차수(MajorWeek) 구간의 WarehouseMaster/WarehouseDetail 입고 라인을
// 통화(currency)+카테고리(category)별로 묶어, 그 통화·카테고리가 실제 입고된 날짜들의 목록과
// 각 날짜의 가중치(그 날짜에 입고된 라인의 TPrice 합)를 돌려준다. 호출자는 이 날짜 목록으로
// 관세청 고시 주간 과세환율(날짜별 1개)을 조회한 뒤, weightedRateFromDatePoints()로
// TPrice 가중평균 환율을 계산한다.
//
// 날짜 우선순위(WarehouseMaster, 실제 컬럼명 확인 완료 — lib/exeWarehouseViewSql.js,
// docs/DB_STRUCTURE.md §1.4 참조): InputDate → (있으면) ArrivalDtm → (없으면) UploadDtm.
// ⚠️ ArrivalDtm 존재 여부는 docs/DB_STRUCTURE.md 문서상 컬럼 목록에만 있고, 실제로 그 컬럼을
// SELECT하는 기존 운영 쿼리가 저장소 어디에도 없었다(InputDate/UploadDtm만 실사용). 문서만 믿고
// COALESCE에 무조건 넣으면 실제 배포 DB에 컬럼 자체가 없는 경우 "Invalid column name" 오류로
// 이 조회 전체가 죽을 수 있다. 그래서 이 파일은 실행 시점에 INFORMATION_SCHEMA.COLUMNS로 컬럼
// 존재 여부만 가볍게(메타데이터 카탈로그 조회, 데이터 스캔 아님) 1회 확인해 캐시하고, 없으면
// InputDate→UploadDtm 2단계로 자동 축소한다(resolveDateExpr). 컬럼이 존재하지만 값이 대부분
// NULL이어도 COALESCE 특성상 안전하다(그 행만 다음 우선순위로 자연스럽게 넘어감).
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
// 날짜 우선순위 식(InputDate>ArrivalDtm>UploadDtm, ArrivalDtm 실측 결과에 따라 자동 축소)은
// lib/profitReportDeclarationDate.js#declarationDateDiagnostics() 단일 원천을 그대로 가져다 쓴다 —
// 이 파일에서 INFORMATION_SCHEMA 프로브를 복제하지 않는다(불일치 시 두 모듈이 서로 다른 날짜를
// 쓰게 되는 위험을 없애기 위함).
import { query, sql } from './db.js';
import { CASE_CATEGORY, stockablePurchaseItemSql, currencyCodeForCategory } from './profitReport.js';
import { EXTRA_CATEGORY } from './profitReportClassification.js';
import { declarationDateDiagnostics } from './profitReportDeclarationDate.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

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
 */
export function mapCategoryDateRowsToWeights(rawRows) {
  const out = [];
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const category = row?.Category;
    if (!category || category === EXTRA_CATEGORY) continue;
    const date = toDateKey(row?.ResolvedDate);
    if (!date) continue;
    const weight = n0(row?.Weight);
    if (weight <= 0) continue;
    const currency = currencyCodeForCategory(category);
    if (!currency) continue;
    out.push({ category, currency, date, weight });
  }
  return out.sort((a, b) =>
    a.category.localeCompare(b.category, 'ko') || a.currency.localeCompare(b.currency) || a.date.localeCompare(b.date));
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
  const { expr: dateExpr } = await declarationDateDiagnostics();
  // InputDate/ArrivalDtm/UploadDtm 은 모두 DATETIME 성격이라 시각(시:분:초)까지 다를 수 있다.
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
        AND ${dateOnlyExpr} IS NOT NULL
        AND ISNULL(wd.TPrice, 0) > 0
        AND ${stockablePurchaseItemSql('p')}
      GROUP BY ${CASE_CATEGORY}, ${dateOnlyExpr}`,
    {
      pfx: { type: sql.NVarChar, value: `${major}-%` },
      yr: { type: sql.NVarChar, value: String(orderYear) },
    },
  );
  return mapCategoryDateRowsToWeights(result.recordset || []);
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
