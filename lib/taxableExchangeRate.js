// lib/taxableExchangeRate.js — 매출이익 보고서 R(과세환율) 웹 전용 저장/캐시 모델.
//
// 업무 규칙(2026-08-12 사용자 확정)
//  - R은 **AUD를 포함한 전 통화가** 해당 통관 신고 주차의 **관세청 과세환율**이다.
//    구매현황에 남는 상업(환전) 환율과는 원래 다른 값이며, 그 값으로 맞추는 보정은 하지 않는다.
//  - 구매(Q)나 포워딩(S) 금액이 있는데 과세환율 원천이 없으면 **원천 누락**으로 표시하고
//    담당자 입력 또는 공식 조회 대상으로 남긴다.
//  - **과거 주차에 현재 CurrencyMaster 환율을 자동 적용하지 않는다.** CurrencyMaster는 "지금 이
//    순간의 마스터 환율"이라 과거 통관 신고 주차의 과세환율과 무관하며, 자동 상속하면 틀린 값이
//    맞는 값처럼 보인다. 전차수 값도 마찬가지로 자동 상속하지 않고 "참고값" 제안까지만 한다.
//
// 우선순위(resolveTaxableRate)
//   1. 해당 주차 FreightCost.ExchangeRate 스냅샷(입고 통관 시점에 이미 박제된 과세환율)
//   2. 해당 주차에 저장/캐시된 공식 과세환율(WebTaxableExchangeRate, source='kcs_api'|'manual'|'cache')
//   3. 사용자가 이 보고서에 직접 입력한 값(WebProfitReport.R — 호출부에서 이 함수 결과 위에 덮어씀)
//   그 밖에는 missing. 전차수 값은 `carry`(참고 제안)로만 반환하며 rate에 절대 넣지 않는다.
//
// 저장 키: OrderYear + MajorWeek + Currency (+ Category). Category=''는 그 주차·통화의 기본값이고,
//   Category가 지정된 행은 그 카테고리 전용 값이다. 원본 워크북 27차가 같은 USD인데도
//   콜롬비아 1538.30 / 태국·에콰도르 1548.52로 서로 달랐던 것처럼(통관 신고 주차가 달라서 생기는
//   정상적인 차이) 카테고리별 예외를 표현할 수 있어야 하기 때문이다.
//
// GET은 SELECT 전용이다 — 이 모듈의 조회 함수는 CREATE/ALTER/MERGE를 하지 않는다.
// 스키마 생성은 저장 경로(ensureTaxableRateTable)와 배포 마이그레이션
// (docs/migrations/2026-08-12_web_taxable_exchange_rate.sql)에서만 수행한다.
import { query, sql, withTransaction } from './db.js';

export const TAXABLE_RATE_SOURCES = {
  FREIGHT_SNAPSHOT: 'freight_cost_snapshot', // 입고 통관 스냅샷(FreightCost.ExchangeRate)
  OFFICIAL_SAVED: 'official_week_saved',     // 그 주차 공식 과세환율 저장/캐시값
  MANUAL: 'manual_invoice',                  // 담당자 직접 입력(인보이스 과세환율)
  MISSING: 'missing',                        // 원천 없음 — 입력/공식조회 대상
};

/** 관세청(UNIPASS) 과세환율 OpenAPI 키 이름. 값은 절대 코드에 넣지 않는다.
 * 키가 없으면 자동 조회를 시도하지 않고 원천 누락(missing)으로 남긴다. */
export const KCS_API_KEY_ENV = 'KCS_EXCHANGE_RATE_API_KEY';
export const KCS_API_URL_ENV = 'KCS_EXCHANGE_RATE_API_URL';

export function hasKcsApiCredentials(env = process.env) {
  return Boolean(env?.[KCS_API_KEY_ENV] && env?.[KCS_API_URL_ENV]);
}

let _ensured = null;
/** 저장(POST) 경로 전용 — idempotent 스키마 생성. GET에서는 절대 호출하지 않는다. */
export async function ensureTaxableRateTable() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebTaxableExchangeRate')
       BEGIN
         CREATE TABLE WebTaxableExchangeRate (
           AutoKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL,
           MajorWeek NVARCHAR(4) NOT NULL,
           Currency NVARCHAR(8) NOT NULL,
           Category NVARCHAR(60) NOT NULL CONSTRAINT DF_WebTaxableExchangeRate_Category DEFAULT N'',
           Rate FLOAT NOT NULL,
           RateSource NVARCHAR(30) NOT NULL,      -- 'kcs_api' | 'manual' | 'cache'
           SourceRefFrom NVARCHAR(10) NULL,        -- 공식 고시 적용 시작일 YYYY-MM-DD
           SourceRefTo NVARCHAR(10) NULL,          -- 공식 고시 적용 종료일 YYYY-MM-DD
           SourceNote NVARCHAR(200) NULL,
           SavedBy NVARCHAR(50), SavedAt DATETIME DEFAULT GETDATE()
         );
         CREATE UNIQUE INDEX UX_WebTaxableExchangeRate
           ON WebTaxableExchangeRate(OrderYear, MajorWeek, Currency, Category);
       END`, {},
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebTaxableExchangeRateHistory')
       BEGIN
         CREATE TABLE WebTaxableExchangeRateHistory (
           HistoryKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL,
           Currency NVARCHAR(8) NOT NULL, Category NVARCHAR(60) NOT NULL,
           OldRate FLOAT NULL, NewRate FLOAT NULL,
           OldSource NVARCHAR(30) NULL, NewSource NVARCHAR(30) NULL,
           ChangedBy NVARCHAR(50), ChangedAt DATETIME DEFAULT GETDATE()
         );
         CREATE INDEX IX_WebTaxableExchangeRateHistory_Key
           ON WebTaxableExchangeRateHistory(OrderYear, MajorWeek, Currency);
       END`, {},
    );
  })();
  return _ensured;
}

/** GET 전용 스키마 확인 — 없으면 503으로 안내하고 DDL은 하지 않는다. */
export async function assertTaxableRateReadSchema() {
  const result = await query(
    `SELECT v.TableName
       FROM (VALUES (N'WebTaxableExchangeRate'), (N'WebTaxableExchangeRateHistory')) v(TableName)
      WHERE OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL`, {},
  );
  const missing = result.recordset.map((row) => row.TableName);
  if (missing.length) {
    const error = new Error(`과세환율 스키마가 설치되지 않았습니다: ${missing.join(', ')}. 배포 마이그레이션을 먼저 실행하세요.`);
    error.code = 'TAXABLE_RATE_SCHEMA_MISSING';
    error.statusCode = 503;
    throw error;
  }
}

/** 테이블 존재 여부만 SELECT로 확인 — DDL 없음. */
export async function taxableRateTableExists() {
  const r = await query(`SELECT OBJECT_ID(N'dbo.WebTaxableExchangeRate', N'U') AS id`, {});
  return r.recordset[0]?.id != null;
}

/** 한 대차수의 저장/캐시된 과세환율 전부 — SELECT 전용.
 * @returns {{ byCurrency: Record<string, object>, byCategory: Record<string, object> }} */
export async function loadTaxableRates(major, orderYear) {
  // 마이그레이션 전 운영 DB에서도 보고서 조회 자체는 막지 않는다 — 테이블이 없으면 저장값 없음으로 본다.
  // (DDL은 절대 실행하지 않는다. GET은 SELECT 전용.)
  if (!(await taxableRateTableExists())) return { byCurrency: {}, byCategory: {}, schemaMissing: true };
  const r = await query(
    `SELECT Currency, Category, Rate, RateSource, SourceRefFrom, SourceRefTo, SourceNote,
            SavedBy, CONVERT(varchar(19), SavedAt, 120) AS SavedAt
       FROM WebTaxableExchangeRate
      WHERE OrderYear=@yr AND MajorWeek=@wk`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: String(major) } },
  );
  const byCurrency = {}, byCategory = {};
  for (const row of r.recordset) {
    const entry = {
      rate: Number(row.Rate), rateSource: row.RateSource,
      sourceRefFrom: row.SourceRefFrom, sourceRefTo: row.SourceRefTo, sourceNote: row.SourceNote,
      savedBy: row.SavedBy, savedAt: row.SavedAt, currency: row.Currency, category: row.Category || '',
    };
    if (row.Category) byCategory[row.Category] = entry;
    else byCurrency[row.Currency] = entry;
  }
  return { byCurrency, byCategory };
}

/** 저장 — 변경분만 이력에 남기고 MERGE 한 트랜잭션. 웹 전용 2개 테이블만 쓴다. */
export async function saveTaxableRates(major, orderYear, entries, actor) {
  await ensureTaxableRateTable();
  const list = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && e.currency && Number(e.rate) > 0,
  );
  if (!list.length) return { saved: 0 };
  const existing = await loadTaxableRates(major, orderYear);
  await withTransaction(async (tQ) => {
    for (const entry of list) {
      const category = entry.category || '';
      const prev = category ? existing.byCategory[category] : existing.byCurrency[entry.currency];
      const params = {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        wk: { type: sql.NVarChar, value: String(major) },
        cur: { type: sql.NVarChar, value: String(entry.currency) },
        cat: { type: sql.NVarChar, value: category },
        rate: { type: sql.Float, value: Number(entry.rate) },
        src: { type: sql.NVarChar, value: entry.rateSource || 'manual' },
        from: { type: sql.NVarChar, value: entry.sourceRefFrom || null },
        to: { type: sql.NVarChar, value: entry.sourceRefTo || null },
        note: { type: sql.NVarChar, value: entry.sourceNote || null },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      };
      if (!prev || Math.abs(Number(prev.rate) - Number(entry.rate)) > 1e-9 || prev.rateSource !== params.src.value) {
        await tQ(
          `INSERT INTO WebTaxableExchangeRateHistory
             (OrderYear, MajorWeek, Currency, Category, OldRate, NewRate, OldSource, NewSource, ChangedBy)
           VALUES (@yr, @wk, @cur, @cat, @oldRate, @rate, @oldSrc, @src, @actor)`,
          {
            ...params,
            oldRate: { type: sql.Float, value: prev ? Number(prev.rate) : null },
            oldSrc: { type: sql.NVarChar, value: prev ? prev.rateSource : null },
          },
        );
      }
      await tQ(
        `MERGE WebTaxableExchangeRate AS t
         USING (SELECT @yr AS OrderYear, @wk AS MajorWeek, @cur AS Currency, @cat AS Category) AS s
            ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Currency=s.Currency AND t.Category=s.Category
         WHEN MATCHED THEN UPDATE SET Rate=@rate, RateSource=@src, SourceRefFrom=@from, SourceRefTo=@to,
                                      SourceNote=@note, SavedBy=@actor, SavedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Currency, Category, Rate, RateSource,
                                       SourceRefFrom, SourceRefTo, SourceNote, SavedBy)
              VALUES (@yr, @wk, @cur, @cat, @rate, @src, @from, @to, @note, @actor);`,
        params,
      );
    }
  });
  return { saved: list.length };
}

/** 변경 이력 조회(최신순) — SELECT 전용. */
export async function loadTaxableRateHistory(major, orderYear, currency, limit = 30) {
  await assertTaxableRateReadSchema();
  const r = await query(
    `SELECT TOP (${Number(limit) || 30}) Currency, Category, OldRate, NewRate, OldSource, NewSource,
            ChangedBy, CONVERT(varchar(19), ChangedAt, 120) AS ChangedAt
       FROM WebTaxableExchangeRateHistory
      WHERE OrderYear=@yr AND MajorWeek=@wk ${currency ? 'AND Currency=@cur' : ''}
      ORDER BY HistoryKey DESC`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      wk: { type: sql.NVarChar, value: String(major) },
      ...(currency ? { cur: { type: sql.NVarChar, value: String(currency) } } : {}),
    },
  );
  return r.recordset;
}

/**
 * 한 카테고리의 R을 결정한다 — 순수 함수(DB 의존 없음, 화면/서버 공용).
 *
 * @param {object} args
 *  - currency        카테고리 통화(없으면 공제/미분류 → 계산 대상 아님)
 *  - snapshotRate    이 주차 FreightCost.ExchangeRate 가중평균(있으면 1순위)
 *  - savedRate       이 주차 저장/캐시된 공식 과세환율 { rate, rateSource, ... }
 *  - manualRate      담당자가 이 보고서에 직접 입력한 값(WebProfitReport.R)
 *  - previousRate    전차수 값 — **참고 제안 전용**, 계산에 넣지 않는다
 *  - hasPurchase     이 카테고리에 구매(Q) 또는 포워딩(S) 금액이 있는지
 * @returns {{ rate:number|null, source:string, carry:number|null, needsInput:boolean }}
 */
export function resolveTaxableRate({
  currency, snapshotRate, savedRate, manualRate, previousRate, hasPurchase,
}) {
  const carry = Number(previousRate) > 0 ? Number(previousRate) : null;
  if (!currency) return { rate: null, source: TAXABLE_RATE_SOURCES.MISSING, carry: null, needsInput: false };
  if (Number(manualRate) > 0) {
    return { rate: Number(manualRate), source: TAXABLE_RATE_SOURCES.MANUAL, carry, needsInput: false };
  }
  if (Number(snapshotRate) > 0) {
    return { rate: Number(snapshotRate), source: TAXABLE_RATE_SOURCES.FREIGHT_SNAPSHOT, carry, needsInput: false };
  }
  if (Number(savedRate?.rate) > 0) {
    return {
      rate: Number(savedRate.rate),
      source: TAXABLE_RATE_SOURCES.OFFICIAL_SAVED,
      officialSource: savedRate.rateSource,
      sourceRefFrom: savedRate.sourceRefFrom,
      sourceRefTo: savedRate.sourceRefTo,
      carry,
      needsInput: false,
    };
  }
  // 원천 없음. CurrencyMaster·전차수 값으로 조용히 채우지 않는다 — 구매/포워딩이 있으면 입력 대상.
  return { rate: null, source: TAXABLE_RATE_SOURCES.MISSING, carry, needsInput: Boolean(hasPurchase) };
}
