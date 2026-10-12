-- 과세환율(R) 웹 전용 저장/캐시 원장 + 변경 이력.
-- lib/taxableExchangeRate.js의 ensureTaxableRateTable()과 동일하며 반복 실행할 수 있다.
--
-- 업무 규칙
--  * R은 AUD 포함 전 통화가 그 통관 신고 주차의 관세청 과세환율이다(상업/환전 환율 아님).
--  * 과거 주차에 현재 CurrencyMaster 환율을 자동 적용하지 않는다 — 원천이 없으면 원천 누락으로 남긴다.
--  * 키는 OrderYear + MajorWeek + Currency (+ Category). Category=N''은 그 주차·통화의 기본값,
--    Category 지정 행은 그 카테고리 전용 예외값이다(원본 27차에서 같은 USD가 콜롬비아 1538.30,
--    태국·에콰도르 1548.52로 달랐던 정상 케이스를 표현하기 위함).
--  * ERP 공용 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ProductStock/Estimate 등)은
--    이 마이그레이션이 전혀 건드리지 않는다. 신규 웹 전용 테이블 2개만 만든다.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebTaxableExchangeRate')
BEGIN
  CREATE TABLE WebTaxableExchangeRate (
    AutoKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    Currency NVARCHAR(8) NOT NULL,
    Category NVARCHAR(60) NOT NULL CONSTRAINT DF_WebTaxableExchangeRate_Category DEFAULT N'',
    Rate FLOAT NOT NULL,
    RateSource NVARCHAR(30) NOT NULL,   -- 'kcs_api' | 'manual' | 'cache'
    SourceRefFrom NVARCHAR(10) NULL,    -- 공식 고시 적용 시작일 YYYY-MM-DD
    SourceRefTo NVARCHAR(10) NULL,      -- 공식 고시 적용 종료일 YYYY-MM-DD
    SourceNote NVARCHAR(200) NULL,
    SavedBy NVARCHAR(50),
    SavedAt DATETIME DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_WebTaxableExchangeRate
    ON WebTaxableExchangeRate(OrderYear, MajorWeek, Currency, Category);
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebTaxableExchangeRateHistory')
BEGIN
  CREATE TABLE WebTaxableExchangeRateHistory (
    HistoryKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    Currency NVARCHAR(8) NOT NULL,
    Category NVARCHAR(60) NOT NULL,
    OldRate FLOAT NULL,
    NewRate FLOAT NULL,
    OldSource NVARCHAR(30) NULL,
    NewSource NVARCHAR(30) NULL,
    ChangedBy NVARCHAR(50),
    ChangedAt DATETIME DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebTaxableExchangeRateHistory_Key
    ON WebTaxableExchangeRateHistory(OrderYear, MajorWeek, Currency);
END;

-- 2026년 22~27차 원본 워크북("매출원가 양식 - NN차_재고수정.xlsx") 본표 R열에 직접 입력돼 있던
-- 과세환율. 이미 저장된 행이 있으면 절대 덮어쓰지 않는다(운영자 입력 우선).
-- USD는 같은 주차 안에서도 콜롬비아와 태국/에콰도르가 달랐으므로 카테고리 지정 행으로 넣는다.
-- 비어 있던 통화(예: 22·25·26차 AUD)는 그 주 실제 구매가 없어 원본도 공란이었으므로 seed하지 않는다.
;WITH seed(OrderYear, MajorWeek, Currency, Category, Rate) AS (
  SELECT * FROM (VALUES
    (N'2026', N'22', N'CNY', N'', 220.96),
    (N'2026', N'22', N'EUR', N'', 1754.12),
    (N'2026', N'22', N'USD', N'베트남', 1504.04),
    (N'2026', N'22', N'USD', N'에콰도르', 1507.15),
    (N'2026', N'22', N'USD', N'콜롬비아 루스커스', 1504.04),
    (N'2026', N'22', N'USD', N'콜롬비아 수국', 1504.04),
    (N'2026', N'22', N'USD', N'콜롬비아 알스트로', 1504.04),
    (N'2026', N'22', N'USD', N'콜롬비아 장미', 1504.04),
    (N'2026', N'22', N'USD', N'콜롬비아 카네이션', 1504.04),
    (N'2026', N'22', N'USD', N'태국', 1507.15),
    (N'2026', N'23', N'AUD', N'', 1079.48),
    (N'2026', N'23', N'CNY', N'', 221.96),
    (N'2026', N'23', N'EUR', N'', 1761.08),
    (N'2026', N'23', N'USD', N'에콰도르', 1507.15),
    (N'2026', N'23', N'USD', N'콜롬비아 루스커스', 1507.15),
    (N'2026', N'23', N'USD', N'콜롬비아 수국', 1507.15),
    (N'2026', N'23', N'USD', N'콜롬비아 알스트로', 1507.15),
    (N'2026', N'23', N'USD', N'콜롬비아 장미', 1507.15),
    (N'2026', N'23', N'USD', N'콜롬비아 카네이션', 1507.15),
    (N'2026', N'23', N'USD', N'태국', 1514.68),
    (N'2026', N'24', N'AUD', N'', 1083.36),
    (N'2026', N'24', N'CNY', N'', 226.09),
    (N'2026', N'24', N'EUR', N'', 1767.31),
    (N'2026', N'24', N'USD', N'베트남', 1514.68),
    (N'2026', N'24', N'USD', N'에콰도르', 1531.46),
    (N'2026', N'24', N'USD', N'콜롬비아 루스커스', 1514.68),
    (N'2026', N'24', N'USD', N'콜롬비아 수국', 1514.68),
    (N'2026', N'24', N'USD', N'콜롬비아 알스트로', 1514.68),
    (N'2026', N'24', N'USD', N'콜롬비아 장미', 1514.68),
    (N'2026', N'24', N'USD', N'콜롬비아 카네이션', 1514.68),
    (N'2026', N'24', N'USD', N'태국', 1531.46),
    (N'2026', N'25', N'CNY', N'', 226.09),
    (N'2026', N'25', N'EUR', N'', 1751.87),
    (N'2026', N'25', N'USD', N'에콰도르', 1516.02),
    (N'2026', N'25', N'USD', N'콜롬비아 루스커스', 1531.46),
    (N'2026', N'25', N'USD', N'콜롬비아 수국', 1531.46),
    (N'2026', N'25', N'USD', N'콜롬비아 알스트로', 1531.46),
    (N'2026', N'25', N'USD', N'콜롬비아 장미', 1531.46),
    (N'2026', N'25', N'USD', N'콜롬비아 카네이션', 1531.46),
    (N'2026', N'25', N'USD', N'태국', 1516.02),
    (N'2026', N'26', N'CNY', N'', 224.27),
    (N'2026', N'26', N'EUR', N'', 1753.54),
    (N'2026', N'26', N'USD', N'베트남', 1516.02),
    (N'2026', N'26', N'USD', N'에콰도르', 1538.3),
    (N'2026', N'26', N'USD', N'콜롬비아 루스커스', 1516.02),
    (N'2026', N'26', N'USD', N'콜롬비아 수국', 1516.02),
    (N'2026', N'26', N'USD', N'콜롬비아 알스트로', 1516.02),
    (N'2026', N'26', N'USD', N'콜롬비아 장미', 1516.02),
    (N'2026', N'26', N'USD', N'콜롬비아 카네이션', 1516.02),
    (N'2026', N'26', N'USD', N'태국', 1538.3),
    (N'2026', N'27', N'AUD', N'', 1068.23),
    (N'2026', N'27', N'CNY', N'', 226.66),
    (N'2026', N'27', N'EUR', N'', 1766.5),
    (N'2026', N'27', N'USD', N'에콰도르', 1548.52),
    (N'2026', N'27', N'USD', N'콜롬비아 루스커스', 1538.3),
    (N'2026', N'27', N'USD', N'콜롬비아 수국', 1538.3),
    (N'2026', N'27', N'USD', N'콜롬비아 알스트로', 1538.3),
    (N'2026', N'27', N'USD', N'콜롬비아 장미', 1538.3),
    (N'2026', N'27', N'USD', N'콜롬비아 카네이션', 1538.3),
    (N'2026', N'27', N'USD', N'태국', 1548.52)
  ) v(OrderYear, MajorWeek, Currency, Category, Rate)
)
INSERT INTO WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
SELECT s.OrderYear, s.MajorWeek, s.Currency, s.Category, s.Rate, N'manual',
       N'원본 "매출원가 양식 - NN차_재고수정.xlsx" 본표 R열(과세환율) historical snapshot', N'migration'
  FROM seed s
 WHERE NOT EXISTS (
   SELECT 1 FROM WebTaxableExchangeRate t
    WHERE t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek
      AND t.Currency=s.Currency AND t.Category=s.Category
 );
