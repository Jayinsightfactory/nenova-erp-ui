-- docs/migrations/2026-08-12_web_taxable_exchange_rate.sql
-- 과세환율(관세청 신고환율, 매출이익 보고서 R열) 웹 전용 저장/캐시 테이블.
--
-- 실행 순서: 이 파일 → 2026-08-12_web_profit_report_historical_seed.sql
--
-- 배경: R은 "통관 신고 시점의 관세청 과세환율"이며 구매현황의 상업(환전) 환율과도, 현재
-- CurrencyMaster 환율과도 다르다. 과거 차수에 오늘의 CurrencyMaster 값을 자동 적용하면 확정 손익이
-- 조용히 바뀌므로, 정확한 OrderYear+MajorWeek 키로 저장된 값만 자동 적용한다(lib/taxableExchangeRate.js).
--
-- 키가 Currency만이 아니라 Category까지 갖는 이유: 같은 통화라도 통관 신고 주차가 다르면 값이 다르다.
--   예) 2026년 27차 USD — 콜롬비아 1,538.30 / 태국·에콰도르 1,548.52 (원본 "매출원가 양식 - 27차" 본표 R열)
-- Category=N'' 행은 그 주·그 통화의 기본값이고, 카테고리 지정 행이 있으면 그 행이 우선한다.
--
-- ERP 공용 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/
-- Estimate/ProductStock/StockHistory)은 읽지도 쓰지도 않는다. 웹 전용 테이블만 만든다.
-- 멱등이다 — 여러 번 실행해도 안전하다.

SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebTaxableExchangeRate')
BEGIN
  CREATE TABLE dbo.WebTaxableExchangeRate (
    AutoKey            INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear          NVARCHAR(4)  NOT NULL,
    MajorWeek          NVARCHAR(4)  NOT NULL,
    Currency           NVARCHAR(10) NOT NULL,   -- 'USD'/'EUR'/'AUD'/'CNY'… (카테고리 전용 행은 N'')
    Category           NVARCHAR(60) NOT NULL,   -- N'' = 그 주·그 통화의 기본값
    Rate               FLOAT        NOT NULL,
    RateSource         NVARCHAR(40) NOT NULL,   -- saved_official_week | kcs_api | manual_input | excel_historical_snapshot
    SourceDate         DATE         NULL,       -- 과세환율 고시 기준일
    SourceRangeStart   DATE         NULL,       -- 주간 고시 적용 시작일
    SourceRangeEnd     DATE         NULL,       -- 주간 고시 적용 종료일
    SourceNote         NVARCHAR(300) NULL,
    SavedBy            NVARCHAR(50) NULL,
    SavedAt            DATETIME     NOT NULL CONSTRAINT DF_WebTaxableExchangeRate_SavedAt DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_WebTaxableExchangeRate
    ON dbo.WebTaxableExchangeRate(OrderYear, MajorWeek, Currency, Category);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebTaxableExchangeRateHistory')
BEGIN
  CREATE TABLE dbo.WebTaxableExchangeRateHistory (
    HistoryKey  INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear   NVARCHAR(4)  NOT NULL,
    MajorWeek   NVARCHAR(4)  NOT NULL,
    Currency    NVARCHAR(10) NOT NULL,
    Category    NVARCHAR(60) NOT NULL,
    OldRate     FLOAT        NULL,
    NewRate     FLOAT        NULL,
    OldSource   NVARCHAR(40) NULL,
    NewSource   NVARCHAR(40) NULL,
    ChangedBy   NVARCHAR(50) NULL,
    ChangedAt   DATETIME     NOT NULL CONSTRAINT DF_WebTaxableExchangeRateHistory_ChangedAt DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebTaxableExchangeRateHistory_Key
    ON dbo.WebTaxableExchangeRateHistory(OrderYear, MajorWeek, Currency, Category);
END
GO
