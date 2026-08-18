// lib/taxableExchangeRate.js — 과세환율(관세청 신고환율, 보고서 R열) 웹 전용 저장/캐시.
//
// ## 왜 별도 테이블인가
// R은 "통관 신고 시점의 관세청 과세환율"이다. 구매현황에 남는 상업(환전) 환율과 다르고,
// **현재 CurrencyMaster 환율과도 다르다**. 과거 차수 보고서에 오늘의 CurrencyMaster 값을 자동으로
// 채우면 과거 손익이 조용히 바뀐다(2026-08-12 결함수정: 이전 구현은 CurrencyMaster를 자동 fallback으로
// 적용했고, 29차 이후에는 전차수 R을 자동 상속까지 했다). 이제 CurrencyMaster/전차수 값은
// **제안(suggestion)** 으로만 화면에 뜨고, 사용자가 적용·저장해야 계산에 들어간다.
//
// ## 키
// OrderYear + MajorWeek + Currency + Category. 같은 통화라도 통관 신고 주차가 다르면 값이 다르므로
// (원본 27차: 콜롬비아 USD 1538.30 / 태국·에콰도르 USD 1548.52) 카테고리 단위 행을 허용한다.
// Category=N'' 행은 그 주·그 통화의 기본값이며, 카테고리 지정 행이 있으면 그 행이 우선한다.
//
// ## 읽기 계약
// GET 경로는 SELECT 전용이다. 테이블이 아직 없으면(마이그레이션 미실행) 예외 대신 빈 결과를 돌려
// 기존 화면이 계속 동작하게 한다. 생성(DDL)은 저장(POST) 경로와 배포 마이그레이션에서만 한다.
import { query, sql, withTransaction } from './db.js';
import { getKcsTaxableRate } from './kcsTaxableRate.js';
import { loadWarehouseDateWeights, weightedRateFromDatePoints } from './kcsRateDateWeights.js';

export const TAXABLE_RATE_TABLE = 'WebTaxableExchangeRate';
export const TAXABLE_RATE_HISTORY_TABLE = 'WebTaxableExchangeRateHistory';

/** R 원천 태그 — 화면 배지/감사 메시지가 이 값을 그대로 쓴다. */
export const RATE_SOURCE = {
  FREIGHT_COST_SNAPSHOT: 'freight_cost_snapshot',   // 입고 통관 스냅샷(FreightCost.ExchangeRate) — 당주 정확 일치
  SAVED_OFFICIAL_WEEK: 'saved_official_week',       // 이 주차에 저장/캐시된 과세환율(웹 전용 테이블)
  EXCEL_HISTORICAL: 'excel_historical_snapshot',    // 2026 22~27차 원본 엑셀 본표 R열
  KCS_API: 'kcs_api',                               // 관세청 과세환율 API 조회 캐시
  MANUAL_INPUT: 'manual_input',                     // 담당자 직접 입력
  MISSING: 'missing',                               // 원천 없음 — 입력/조회 필요
};

/** 자동 적용을 허용하는 원천(= "정확한 그 주차" 원천). 이 목록에 없는 값은 제안일 뿐이다. */
export const EXACT_WEEK_RATE_SOURCES = new Set([
  RATE_SOURCE.FREIGHT_COST_SNAPSHOT,
  RATE_SOURCE.SAVED_OFFICIAL_WEEK,
  RATE_SOURCE.EXCEL_HISTORICAL,
  RATE_SOURCE.KCS_API,
  RATE_SOURCE.MANUAL_INPUT,
]);

let _ensured = null;
export async function ensureTaxableRateTables() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='${TAXABLE_RATE_TABLE}')
       BEGIN
         CREATE TABLE ${TAXABLE_RATE_TABLE} (
           AutoKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL,
           MajorWeek NVARCHAR(4) NOT NULL,
           Currency NVARCHAR(10) NOT NULL,          -- 'USD'/'EUR'/'AUD'/'CNY'… (카테고리 전용 행은 N'')
           Category NVARCHAR(60) NOT NULL,          -- N'' = 그 주·그 통화의 기본값
           Rate FLOAT NOT NULL,
           RateSource NVARCHAR(40) NOT NULL,        -- saved_official_week | kcs_api | manual_input | excel_historical_snapshot
           SourceDate DATE NULL,                    -- 과세환율 고시 기준일
           SourceRangeStart DATE NULL,              -- 고시 적용 시작일(주간 고시)
           SourceRangeEnd DATE NULL,                -- 고시 적용 종료일
           SourceNote NVARCHAR(300) NULL,
           SavedBy NVARCHAR(50), SavedAt DATETIME DEFAULT GETDATE()
         );
         CREATE UNIQUE INDEX UX_${TAXABLE_RATE_TABLE} ON ${TAXABLE_RATE_TABLE}(OrderYear, MajorWeek, Currency, Category);
       END`, {},
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='${TAXABLE_RATE_HISTORY_TABLE}')
       BEGIN
         CREATE TABLE ${TAXABLE_RATE_HISTORY_TABLE} (
           HistoryKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL,
           Currency NVARCHAR(10) NOT NULL, Category NVARCHAR(60) NOT NULL,
           OldRate FLOAT NULL, NewRate FLOAT NULL,
           OldSource NVARCHAR(40) NULL, NewSource NVARCHAR(40) NULL,
           ChangedBy NVARCHAR(50), ChangedAt DATETIME DEFAULT GETDATE()
         );
         CREATE INDEX IX_${TAXABLE_RATE_HISTORY_TABLE}_Key
           ON ${TAXABLE_RATE_HISTORY_TABLE}(OrderYear, MajorWeek, Currency, Category);
       END`, {},
    );
  })();
  return _ensured;
}

/** 테이블이 실제로 있는지 — GET 경로가 DDL 없이 우아하게 건너뛸 수 있도록 SELECT로만 확인한다. */
export async function taxableRateTableExists() {
  const r = await query(`SELECT OBJECT_ID(N'dbo.${TAXABLE_RATE_TABLE}', N'U') AS ObjId`, {});
  return r.recordset[0]?.ObjId != null;
}

/**
 * 그 주차에 저장/캐시된 과세환율 전부. SELECT 전용이며 테이블이 없으면 빈 객체.
 * @returns {Promise<{byCategory: Record<string, object>, byCurrency: Record<string, object>, rows: object[]}>}
 */
export async function loadTaxableRates(orderYear, major) {
  if (!(await taxableRateTableExists())) return { byCategory: {}, byCurrency: {}, rows: [] };
  const r = await query(
    `SELECT Currency, Category, Rate, RateSource,
            CONVERT(CHAR(10), SourceDate, 23) AS SourceDate,
            CONVERT(CHAR(10), SourceRangeStart, 23) AS SourceRangeStart,
            CONVERT(CHAR(10), SourceRangeEnd, 23) AS SourceRangeEnd,
            SourceNote, SavedBy, CONVERT(varchar(19), SavedAt, 120) AS SavedAt
       FROM ${TAXABLE_RATE_TABLE}
      WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: String(major) } },
  );
  const byCategory = {}, byCurrency = {};
  for (const row of r.recordset) {
    const entry = {
      rate: Number(row.Rate),
      source: row.RateSource,
      sourceDate: row.SourceDate || null,
      sourceRange: row.SourceRangeStart || row.SourceRangeEnd
        ? { start: row.SourceRangeStart || null, end: row.SourceRangeEnd || null } : null,
      sourceNote: row.SourceNote || null,
      savedBy: row.SavedBy || null,
      savedAt: row.SavedAt || null,
    };
    if (row.Category) byCategory[row.Category] = entry;
    else if (row.Currency) byCurrency[row.Currency] = entry;
  }
  return { byCategory, byCurrency, rows: r.recordset };
}

/** 저장/캐시 upsert + 변경이력. POST 경로 전용(DDL 포함). */
export async function saveTaxableRate({ orderYear, major, currency, category, rate, rateSource, sourceDate, sourceRangeStart, sourceRangeEnd, sourceNote }, actor) {
  await ensureTaxableRateTables();
  const params = {
    yr: { type: sql.NVarChar, value: String(orderYear) },
    mw: { type: sql.NVarChar, value: String(major) },
    cur: { type: sql.NVarChar, value: String(currency || '') },
    cat: { type: sql.NVarChar, value: String(category || '') },
    rate: { type: sql.Float, value: Number(rate) },
    src: { type: sql.NVarChar, value: String(rateSource || RATE_SOURCE.MANUAL_INPUT) },
    sd: { type: sql.NVarChar, value: sourceDate || null },
    ss: { type: sql.NVarChar, value: sourceRangeStart || null },
    se: { type: sql.NVarChar, value: sourceRangeEnd || null },
    note: { type: sql.NVarChar, value: sourceNote == null ? null : String(sourceNote).slice(0, 300) },
    actor: { type: sql.NVarChar, value: actor || 'user' },
  };
  await withTransaction(async (tQ) => {
    const existing = await tQ(
      `SELECT Rate, RateSource FROM ${TAXABLE_RATE_TABLE}
        WHERE OrderYear=@yr AND MajorWeek=@mw AND Currency=@cur AND Category=@cat`, params,
    );
    const before = existing.recordset[0] || null;
    await tQ(
      `INSERT INTO ${TAXABLE_RATE_HISTORY_TABLE}
         (OrderYear, MajorWeek, Currency, Category, OldRate, NewRate, OldSource, NewSource, ChangedBy)
       VALUES (@yr, @mw, @cur, @cat, @oldRate, @rate, @oldSrc, @src, @actor)`,
      { ...params, oldRate: { type: sql.Float, value: before ? Number(before.Rate) : null },
        oldSrc: { type: sql.NVarChar, value: before ? before.RateSource : null } },
    );
    await tQ(
      `MERGE ${TAXABLE_RATE_TABLE} AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cur AS Currency, @cat AS Category) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Currency=s.Currency AND t.Category=s.Category
       WHEN MATCHED THEN UPDATE SET Rate=@rate, RateSource=@src, SourceDate=@sd,
            SourceRangeStart=@ss, SourceRangeEnd=@se, SourceNote=@note, SavedBy=@actor, SavedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Currency, Category, Rate, RateSource,
            SourceDate, SourceRangeStart, SourceRangeEnd, SourceNote, SavedBy)
            VALUES (@yr, @mw, @cur, @cat, @rate, @src, @sd, @ss, @se, @note, @actor);`,
      params,
    );
  });
}

/**
 * R 원천 선택(순수 함수, DB 의존 없음 — 서버/클라이언트 공용). 호출부(pages/api/sales/profit-report.js)의
 * 행별 수기 오버라이드(WebProfitReport.R, `man.R`)는 이 함수보다 먼저 적용되어 있어야 한다 — 이
 * 함수는 그 수기값이 없을 때의 자동 원천만 고른다("manual R first"는 호출부 책임).
 *
 * 자동 적용 우선순위(전부 "정확히 그 OrderYear+MajorWeek" 원천만):
 *   1. 당주 입고 통관 스냅샷 FreightCost.ExchangeRate
 *   2. 이 주차에 저장/캐시된 과세환율 — 카테고리 지정 행 > 통화 기본 행
 *      (원본 엑셀 historical snapshot도 이 단계에서 excel_historical_snapshot 태그로 들어온다.
 *      2026년 22~27차 전용이며 그 범위 밖에서는 항상 null이다 — lib/profitReportHistoricalCustoms.js)
 *   3. (2026년 28차 이후 및 그 다음 연도) 관세청 공식 과세환율 API(KCS) — 사용자가 입고에
 *      명시한 WarehouseMaster.InputDate별 환율을 wd.TPrice로 가중평균한다. InputDate가 없을 때는
 *      원본 workbook 반복 규칙과 사용자 확정이 모두 있는 명시적 카테고리 일정(현재 호주 AUD)만
 *      사용하고, 나머지는 입력 필요 상태로 둔다.
 *      (lib/kcsRateDateWeights.js loadWarehouseDateWeights/weightedRateFromDatePoints)
 * 어느 것도 없으면 `missing`이다. **CurrencyMaster 현재 환율과 전차수 R은 자동 적용하지 않고**
 * suggestions로만 돌려준다 — 화면이 "적용" 버튼과 함께 제안으로 보여 주고, 사용자가 저장해야
 * 계산에 반영된다.
 *
 * @param {{snapshotRate:?number, savedByCategory:?object, savedByCurrency:?object,
 *          historicalRate:?number, currency:?string, currencyMasterRate:?number,
 *          previousWeekRate:?number, previousWeekLabel:?string,
 *          kcsRate:?number, kcsDetail:?object}} input
 */
export function resolveTaxableRate(input) {
  const {
    snapshotRate, savedByCategory, savedByCurrency, historicalRate,
    currencyMasterRate, previousWeekRate, previousWeekLabel,
    kcsRate, kcsDetail,
  } = input || {};

  const suggestions = [];
  if (Number(previousWeekRate) > 0) {
    suggestions.push({
      rate: Number(previousWeekRate),
      kind: 'previous_week',
      label: `${previousWeekLabel || '전차수'} 과세환율`,
      note: '참고값입니다. 이번 차수 통관 신고 환율과 다를 수 있으니 확인 후 적용하세요.',
    });
  }
  if (Number(currencyMasterRate) > 0) {
    suggestions.push({
      rate: Number(currencyMasterRate),
      kind: 'currency_master',
      label: '통화마스터 현재 환율',
      note: '과세환율이 아니라 현재 마스터 환율입니다. 과거 차수에는 자동 적용하지 않습니다.',
    });
  }

  if (Number(snapshotRate) > 0) {
    return { rate: Number(snapshotRate), source: RATE_SOURCE.FREIGHT_COST_SNAPSHOT, detail: null, suggestions };
  }
  if (savedByCategory && Number(savedByCategory.rate) > 0) {
    return {
      rate: Number(savedByCategory.rate),
      source: savedByCategory.source || RATE_SOURCE.SAVED_OFFICIAL_WEEK,
      detail: savedByCategory,
      suggestions,
    };
  }
  if (Number(historicalRate) > 0) {
    return { rate: Number(historicalRate), source: RATE_SOURCE.EXCEL_HISTORICAL, detail: null, suggestions };
  }
  if (savedByCurrency && Number(savedByCurrency.rate) > 0) {
    return {
      rate: Number(savedByCurrency.rate),
      source: savedByCurrency.source || RATE_SOURCE.SAVED_OFFICIAL_WEEK,
      detail: savedByCurrency,
      suggestions,
    };
  }
  if (Number(kcsRate) > 0) {
    return { rate: Number(kcsRate), source: RATE_SOURCE.KCS_API, detail: kcsDetail || null, suggestions };
  }
  return { rate: null, source: RATE_SOURCE.MISSING, detail: null, suggestions };
}

/**
 * 관세청 과세환율 공식 조회.
 *
 * 실제 HTTP 조회/파싱/메모리 TTL 캐시는 lib/kcsTaxableRate.js(DB 의존 없는 순수 모듈)에 있고,
 * 이 함수는 그 얇은 래퍼다. `KCS_TAXABLE_RATE_ENABLED`가 명시적으로 'false'가 아니면(미설정
 * 포함) 기본 활성 — 2026년 28차 이후 및 그 다음 연도는 시크릿 없이도 자동 조회를 시도한다. 조회에 성공하면
 * 이 값은 EXACT_WEEK_RATE_SOURCES(정확한 그 주차 원천)로 취급되어 즉시 자동 적용되며, 별도
 * saveTaxableRate() 호출 없이도 계산에 들어간다 — 담당자가 명시적으로 확정해 캐시에 고정하고
 * 싶을 때만 TAXABLE_RATE_SAVE(POST)를 쓴다(기존 저장 경로는 이 기능과 무관하게 그대로 유지).
 *
 * @param {{currency:string, declarationDate:string}} params
 * @returns {Promise<{available:true, rate:number, sourceDate:string, sourceRangeStart:?string,
 *           sourceRangeEnd:?string, sourceNote:string} | {available:false, reason:string, message:string}>}
 */
export async function fetchKcsTaxableRate({ currency, declarationDate }) {
  if (!currency || !declarationDate) {
    return { available: false, reason: 'missing_parameters', message: '통화와 신고일자가 모두 있어야 과세환율을 조회할 수 있습니다.' };
  }
  return getKcsTaxableRate({ currency, declarationDate });
}

const KCS_RATE_YEAR = '2026';
const KCS_RATE_MIN_MAJOR = 28;

/** 이 대차수가 KCS 공식 조회 대상인지 — 2026년 22~27차(원본 엑셀 historical snapshot,
 * lib/profitReportHistoricalCustoms.js) 보존을 위한 단일 게이트. 이 범위 밖에서는
 * loadWarehouseDateWeights() DB 조회도, KCS 네트워크 호출도 전혀 하지 않는다. */
export function isKcsRateEligibleWeek(orderYear, major) {
  const year = Number(orderYear);
  const week = Number(major);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return false;
  return year > Number(KCS_RATE_YEAR)
    || (year === Number(KCS_RATE_YEAR) && week >= KCS_RATE_MIN_MAJOR);
}

/**
 * 카테고리별 관세청 공식 과세환율(KCS) — resolveTaxableRate()의 kcsRate/kcsDetail 입력을 만드는
 * 오케스트레이션. 2026년 28차 이후 및 그 다음 연도에 동작하고(isKcsRateEligibleWeek), 그 범위 밖에서는 DB
 * 조회도 네트워크 호출도 하지 않고 빈 객체를 반환해 22~27차를 그대로 보존한다.
 *
 * lib/kcsRateDateWeights.js#loadWarehouseDateWeights(WarehouseMaster.InputDate 우선, 승인된 일정 보완)로
 * 카테고리별 실제 입고 날짜 전부와 그 날짜의 TPrice 가중치를 받아, 서로
 * 다른 (통화,날짜) 조합마다 fetchKcsTaxableRate()를 정확히 1회만 호출(중복 제거)한 뒤,
 * weightedRateFromDatePoints()로 카테고리별 환율 자체를 TPrice 가중평균한다 — 날짜를 먼저
 * 평균해 그 하루치 환율만 조회하지 않는다(요구사항 그대로: "환율을 날짜별로 가중평균"). 조회가
 * 날짜 하나라도 조회가 실패하면 그 카테고리 전체를 결과에서 빼서 resolveTaxableRate가 자동으로
 * `missing`으로 처리한다. 일부 날짜만으로 계산하거나 값을 추정하지 않는다.
 *
 * @returns {Promise<{byCategory: Record<string, {rate:number, detail:object}>}>}
 */
export async function kcsRatesByCategory(major, orderYear) {
  if (!isKcsRateEligibleWeek(orderYear, major)) return { byCategory: {}, failuresByCategory: {} };
  let points;
  try {
    points = await loadWarehouseDateWeights(orderYear, major);
  } catch (error) {
    return {
      byCategory: {},
      failuresByCategory: { _all: [{ reason: 'date_weight_load_failed', message: error?.message || String(error) }] },
    };
  }
  if (!points.length) return { byCategory: {}, failuresByCategory: {} };

  const pending = new Map();
  const rateFor = (currency, date) => {
    const key = `${currency}::${date}`;
    if (!pending.has(key)) pending.set(key, fetchKcsTaxableRate({ currency, declarationDate: date }));
    return pending.get(key);
  };

  const byCategoryPoints = new Map();
  for (const p of points) {
    if (!byCategoryPoints.has(p.category)) byCategoryPoints.set(p.category, { currency: p.currency, points: [] });
    byCategoryPoints.get(p.category).points.push({
      date: p.date,
      weight: p.weight,
      dateSource: p.dateSource || null,
      scheduleId: p.scheduleId || null,
      missingDeclarationDate: Boolean(p.missingDeclarationDate),
    });
  }

  const resByKey = new Map();
  await Promise.all([...new Set(points.filter((p) => p.date).map((p) => `${p.currency}::${p.date}`))].map(async (key) => {
    const [currency, date] = key.split('::');
    try {
      resByKey.set(key, await rateFor(currency, date));
    } catch (error) {
      resByKey.set(key, { available: false, reason: 'fetch_failed', message: error?.message || String(error) });
    }
  }));

  const byCategory = {};
  const failuresByCategory = {};
  for (const [category, { currency, points: datePoints }] of byCategoryPoints) {
    const rateByDate = new Map();
    const usedDates = [];
    const failedDates = [];
    for (const dp of datePoints) {
      if (!dp.date || dp.missingDeclarationDate) {
        failedDates.push({ date: null, reason: 'missing_declaration_date', message: '수입신고 기준일(InputDate)이 없습니다.' });
        continue;
      }
      const res = resByKey.get(`${currency}::${dp.date}`);
      if (res?.available) {
        rateByDate.set(dp.date, Number(res.rate));
        usedDates.push({
          date: dp.date,
          weight: dp.weight,
          rate: Number(res.rate),
          dateSource: dp.dateSource || null,
          scheduleId: dp.scheduleId || null,
        });
      } else {
        failedDates.push({ date: dp.date, reason: res?.reason || 'unavailable', message: res?.message || '' });
      }
    }
    if (failedDates.length) {
      failuresByCategory[category] = failedDates;
      continue;
    }
    const rate = weightedRateFromDatePoints(datePoints, rateByDate);
    if (rate != null) {
      byCategory[category] = {
        rate,
        detail: {
          source: RATE_SOURCE.KCS_API,
          currency,
          weightedAvg: usedDates.length > 1,
          distinctDateCount: usedDates.length,
          dates: usedDates,
        },
      };
    }
  }
  return { byCategory, failuresByCategory };
}
