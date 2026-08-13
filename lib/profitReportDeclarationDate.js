// lib/profitReportDeclarationDate.js — WarehouseMaster "관세청 조회 기준일자" 우선순위 SELECT 전용 모듈.
//
// ## 목적
// 2026년 28차 이후 매출이익보고서 R(과세환율)을 관세청 KCS API로 자동 조회하려면 카테고리별로
// "언제 수입신고했는지"를 나타내는 날짜가 있어야 한다. 이 모듈은 그 날짜 우선순위 식(InputDate>
// ArrivalDtm>UploadDtm, ArrivalDtm 실측 결과에 따라 자동 축소)만 읽기 전용으로 산출해 공유한다.
// 실제 카테고리별 TPrice 가중 날짜/가중치 집계는 lib/kcsRateDateWeights.js(다수 날짜×가중치 →
// 날짜별 KCS 조회 후 환율 자체를 가중평균)가 이 식을 가져다 쓴다. 이 모듈은 날짜 하나를 미리
// 평균해 반환하지 않는다 — "관세청 신고환율은 각 실제 신고일자의 실제 환율을 TPrice로 가중평균한다"는
// 요구사항을 정확히 지키려면 날짜를 먼저 평균(pseudo-date)해 그 날 하루치 환율만 조회하는 방식은
// 실제 신고일자가 아닌 날에 대한 환율을 끌어오는 오차가 생기기 때문이다(2026-08-12 설계 정리 —
// 이전 버전은 declarationDateByCategory()로 날짜를 먼저 가중평균했으나 kcsRatesByCategory()가
// lib/kcsRateDateWeights.js 기반으로 교체되며 더는 쓰이지 않아 제거했다).
// 실제 환율 저장(lib/taxableExchangeRate.js saveTaxableRate 등)은 이 모듈의 책임이 아니다.
//
// ## 이 모듈이 DB에 하는 일 = SELECT뿐이다
// 행 추가·수정·삭제나 스키마 변경 같은 쓰기 계열 SQL 명령을 전혀 실행하지 않는다(GET 경로 전용,
// CLAUDE.md 규칙 1 "GET 요청 = 읽기 전용"). 이 파일의 SQL 문자열 템플릿에는 그런 쓰기 계열 키워드가
// 전혀 등장하지 않아야 한다(__tests__/profitReportGetReadOnlyDdl.test.js 류의 정적 검증 대상).
//
// ## ArrivalDtm 컬럼 프로브 (2026-08-12, read-only)
// 이 작업 세션의 sandbox worktree에는 DB 접속 정보(.env.local/DB_SERVER 등 환경변수)가 전혀 없어
// INFORMATION_SCHEMA.COLUMNS 실측 SELECT를 세션 중에 직접 실행할 수 없었다. 그래서 이 모듈은
// "추측 대신 실측"을 지키기 위해, DB 연결이 되는 실제 실행 시점에 스스로 probeArrivalDtmColumn()을
// 최초 1회 실행해 (1) 컬럼이 실제로 존재하는지 INFORMATION_SCHEMA.COLUMNS로, (2) NULL 비율을
// WarehouseMaster COUNT로 실측한 뒤, 컬럼이 없거나 사실상 항상 NULL
// (ARRIVAL_DTM_ALWAYS_NULL_THRESHOLD 이상)이면 우선순위를 InputDate > UploadDtm 으로 자동 축소한다.
// 이 동적 우선순위는 이 모듈 하나가 유일한 원천이며(resolveDeclarationDateExpr), 실제 카테고리별
// 날짜×가중치 집계를 하는 lib/kcsRateDateWeights.js가 declarationDateDiagnostics()를 통해 가져다 쓴다.
// 세션 중 코드/문서 근거(추측 아님, 정적 조사 결과):
//   - docs/DB_STRUCTURE.md:149 는 WarehouseMaster 컬럼 목록에 `ArrivalDtm`을 문서화하고 있다
//     (컬럼 자체는 존재한다고 봄 — INFORMATION_SCHEMA로 재확인은 하되 "없다"고 가정하지 않는다).
//   - 그러나 저장소 전체(scripts/probe-awb.js, lib/exeWarehouseViewSql.js,
//     docs/WEB_VS_ERP_CONFLICTS.md, docs/exe-golden/FormImportPivot.md 등 wm.InputDate/UploadDtm을
//     실제로 SELECT하는 모든 코드)에서 `wm.ArrivalDtm`을 실제로 읽는 쿼리는 하나도 없었다 —
//     InputDate/UploadDtm만 운영 조회에 쓰인다. 이는 ArrivalDtm이 사실상 채워지지 않거나 신뢰되지
//     않는 컬럼일 가능성을 시사할 뿐이므로, 이 모듈은 그 심증을 하드코딩하지 않고 런타임에 직접
//     실측해서 결정한다. 실측 결과는 declarationDateDiagnostics()로 그대로 노출된다.
import { query, sql } from './db.js';

/** WarehouseMaster.ArrivalDtm 이 이 비율 이상 NULL 이면 "사실상 항상 NULL"로 간주해
 * 날짜 우선순위에서 제외한다(존재는 하되 신뢰할 수 없는 컬럼으로 취급). */
const ARRIVAL_DTM_ALWAYS_NULL_THRESHOLD = 0.98;

let _arrivalDtmProbeCache = null;

/**
 * WarehouseMaster.ArrivalDtm 컬럼 존재 여부 + NULL 비율을 read-only 로 실측한다(SELECT/COUNT만).
 * 결과는 프로세스 생존 동안 캐시한다(lib/profitReport.js의 `_ensured` 류 캐시 패턴과 동일 — 매 호출마다
 * 다시 재지 않음).
 *
 * @returns {Promise<{exists:boolean, totalRows:number, nonNullRows:number, nullRatio:number,
 *   effectivelyAlwaysNull:boolean, checkedAt:string}>}
 */
export async function probeArrivalDtmColumn() {
  if (_arrivalDtmProbeCache) return _arrivalDtmProbeCache;

  const colCheck = await query(
    `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @t AND COLUMN_NAME = @c`,
    {
      t: { type: sql.NVarChar, value: 'WarehouseMaster' },
      c: { type: sql.NVarChar, value: 'ArrivalDtm' },
    },
  );
  const exists = Number(colCheck.recordset[0]?.cnt || 0) > 0;

  if (!exists) {
    _arrivalDtmProbeCache = {
      exists: false,
      totalRows: 0,
      nonNullRows: 0,
      nullRatio: 1,
      effectivelyAlwaysNull: true,
      checkedAt: new Date().toISOString(),
    };
    return _arrivalDtmProbeCache;
  }

  const stat = await query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ArrivalDtm IS NOT NULL THEN 1 ELSE 0 END) AS nonNull
       FROM WarehouseMaster
      WHERE ISNULL(isDeleted,0) = 0`,
    {},
  );
  const totalRows = Number(stat.recordset[0]?.total || 0);
  const nonNullRows = Number(stat.recordset[0]?.nonNull || 0);
  const nullRatio = totalRows > 0 ? 1 - nonNullRows / totalRows : 1;

  _arrivalDtmProbeCache = {
    exists: true,
    totalRows,
    nonNullRows,
    nullRatio,
    effectivelyAlwaysNull: nullRatio >= ARRIVAL_DTM_ALWAYS_NULL_THRESHOLD,
    checkedAt: new Date().toISOString(),
  };
  return _arrivalDtmProbeCache;
}

/** 테스트/진단 전용 — 프로브 캐시를 비운다(라이브 DB 재측정을 강제할 때 사용). */
export function resetArrivalDtmProbeCacheForTest() {
  _arrivalDtmProbeCache = null;
}

/**
 * 이번 호출에서 실제로 쓸 날짜 우선순위 SQL 조각을 결정한다.
 * ArrivalDtm이 존재하고 사실상 항상 NULL은 아니면 InputDate > ArrivalDtm > UploadDtm,
 * 아니면(컬럼 없음 또는 사실상 항상 NULL) InputDate > UploadDtm로 축소한다.
 * alias는 WarehouseMaster 별칭(기본 'wm').
 */
async function resolveDeclarationDateExpr(alias = 'wm') {
  const probe = await probeArrivalDtmColumn();
  const usesArrivalDtm = probe.exists && !probe.effectivelyAlwaysNull;
  const expr = usesArrivalDtm
    ? `COALESCE(${alias}.InputDate, ${alias}.ArrivalDtm, ${alias}.UploadDtm)`
    : `COALESCE(${alias}.InputDate, ${alias}.UploadDtm)`;
  return { expr, usesArrivalDtm, probe };
}

/**
 * 이 모듈이 실제로 사용 중인 날짜 우선순위 진단 정보. API/보고 화면에서 "왜 이 우선순위인지"를
 * 그대로 노출할 때 쓴다. DB read-only.
 * @returns {Promise<{usesArrivalDtm:boolean, expr:string, probe:object}>}
 */
export async function declarationDateDiagnostics() {
  return resolveDeclarationDateExpr('wm');
}
