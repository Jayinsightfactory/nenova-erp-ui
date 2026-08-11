-- ============================================================================
-- 2026-08-11  주차별 매출이익 보고서 "보고서 기준 확정(confirm snapshot)" 스키마
-- SSMS 에서 직접 실행. idempotent — 재실행 안전. 스키마만 추가하며,
-- 기존 WebProfitReport 행이나 과거 확정본을 이 새 테이블로 자동 backfill 하지 않는다.
-- (backfill 이 필요하면 사용자가 명시적으로 요청한 뒤 별도 도구로 진행한다.)
--
-- 계약: docs/contracts/weekly-profit-report.json
--   - REPORT_CONFIRM_SNAPSHOT / REPORT_CONFIRM_CANCEL / REPORT_CONFIRM_HISTORY_VIEW / REPORT_CONFIRM_FORCE
--   - erpLedgerWriteProhibition: OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/
--     ShipmentDate/ShipmentFarm/Estimate/ProductStock/StockHistory 는 이 기능이 절대
--     INSERT/UPDATE/DELETE 하지 않는다 — 아래 두 테이블은 Web 전용 신규 테이블이며
--     위 ERP 공유 원장과 FK 관계를 맺지 않는다(스냅샷 좌표는 값으로만 보존).
--
-- PK 정책: WebProfitReportConfirm / WebProfitReportConfirmDetail 은 Web 전용 신규
--   테이블이므로 `WebProfitReport.AutoKey`, `FreightCostDetail.DetailKey` 와 동일하게
--   IDENTITY 를 사용한다. safeNextKey()는 ERP(nenova.exe)와 공유하는 테이블(OrderMaster/
--   ShipmentMaster 등 전산 race 발생 테이블)에만 강제되며, 이 두 테이블은 대상이 아니다.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. WebProfitReportConfirm — 확정 revision 헤더 (1 revision = 1행)
--    OrderYear+MajorWeek 당 IsActive=1 인 행은 정확히 0~1개
--    (필터 유니크 인덱스로 강제). 취소해도 DELETE 하지 않고 IsActive=0 +
--    CancelledBy/CancelledAt 만 UPDATE한다. 재확정은 새 RevisionNo로 새 행을 INSERT한다.
-- ─────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.WebProfitReportConfirm', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportConfirm (
    ConfirmKey        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear         NVARCHAR(4)  NOT NULL,
    MajorWeek         NVARCHAR(4)  NOT NULL,
    RevisionNo        INT          NOT NULL DEFAULT 1,
    IsActive          BIT          NOT NULL DEFAULT 1,

    -- 기초/기말 스냅샷 좌표 (ProductStock 선택 좌표를 그대로 굳힘 — crossYearFixture 참조)
    BeginOrderYear    NVARCHAR(4)  NULL,
    BeginOrderWeek    NVARCHAR(10) NULL,
    BeginStockKey     INT          NULL,
    EndOrderYear      NVARCHAR(4)  NULL,
    EndOrderWeek      NVARCHAR(10) NULL,
    EndStockKey       INT          NULL,

    -- 원천 데이터 변경 감지용 해시 (관련 원천 쿼리 결과 직렬화 해시 문자열)
    SourceHash        NVARCHAR(128) NULL,

    -- 확정 시점 감사(audit) 스냅샷 — lib/profitReportAudit.js buildProfitReportAudit() 결과.
    -- AuditIssuesJson 은 [{severity, code, category, columns, message}, ...] JSON 배열 텍스트.
    AuditStatus       NVARCHAR(20)  NULL,   -- 'ready' | 'needs_review' | 'needs_input'
    AuditIssuesJson   NVARCHAR(MAX) NULL,

    -- 강제 확정(REPORT_CONFIRM_FORCE) 여부/사유. reason 없이 강제확정 저장 금지는 API 레이어 책임.
    IsForced          BIT           NOT NULL DEFAULT 0,
    ForceReason       NVARCHAR(1000) NULL,

    -- UpdatedBy 패턴과 동일한 확정자/취소자 기록
    ConfirmedBy       NVARCHAR(50)  NULL,
    ConfirmedByName   NVARCHAR(100) NULL,
    ConfirmedAt       DATETIME      NOT NULL DEFAULT GETDATE(),
    CancelledBy       NVARCHAR(50)  NULL,
    CancelledByName   NVARCHAR(100) NULL,
    CancelledAt       DATETIME      NULL,

    Notes             NVARCHAR(2000) NULL
  );
END;

-- 활성 확정본은 OrderYear+MajorWeek 당 정확히 1개 (필터 유니크 인덱스로 강제)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_ActiveWeek')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirm_ActiveWeek
  ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek)
  WHERE IsActive = 1;

-- 같은 주차 안에서 RevisionNo 중복 방지 (앱에서 MAX(RevisionNo)+1 로 채번)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_Revision')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirm_Revision
  ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek, RevisionNo);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirm_AuditStatus')
  ALTER TABLE dbo.WebProfitReportConfirm WITH NOCHECK
  ADD CONSTRAINT CK_WebProfitReportConfirm_AuditStatus
  CHECK (AuditStatus IS NULL OR AuditStatus IN (N'ready', N'needs_review', N'needs_input'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. WebProfitReportConfirmDetail — revision 별 카테고리 세부값 (세로 구조, N행)
--    WebProfitReport(OrderYear, MajorWeek, Category, ColKey) 스타일을 따르되,
--    같은 문자(E/F/H/N/L/O/Q/R/S)가 "원천값"과 "계산값" 두 의미로 겹치므로
--    ColType 으로 원천/계산/소스태그를 구분한다.
--      ColType='SOURCE'     : 카테고리별 원천값 N/L/O/Q/R/S/H/E/F
--      ColType='CALC'       : 계산값 C~U (엑셀 열 전부)
--      ColType='SOURCE_TAG' : 환율(R)/통관(H)/포워딩(S) 각각의 원천 태그.
--                              ColKey='R'|'H'|'S', TextValue 에 태그 문자열 저장
--                              (예: 'bill_snapshot' | 'prior_confirmed' |
--                                   'currency_master_fallback' | 'legacy_unverified')
-- ─────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.WebProfitReportConfirmDetail', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportConfirmDetail (
    ConfirmDetailKey  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ConfirmKey        INT          NOT NULL,
    Category          NVARCHAR(60) NOT NULL,   -- 품명 행 카테고리 또는 '_total'
    ColType           NVARCHAR(12) NOT NULL,   -- 'SOURCE' | 'CALC' | 'SOURCE_TAG'
    ColKey            NVARCHAR(20) NOT NULL,   -- N/L/O/Q/R/S/H/E/F 또는 C~U 또는 (SOURCE_TAG 인 경우) R/H/S
    -- 금액/수량/비율 스냅샷은 FLOAT(이진 부동소수점)이 아니라 DECIMAL(38,10)을 쓴다.
    -- 확정본은 재계산되지 않는 불변값이므로, 저장 시점의 반올림 오차가 감사·재계산 대조에서
    -- 그대로 재현돼야 한다 — FLOAT는 같은 값도 왕복(round-trip) 시 이진 오차가 섞일 수 있다.
    -- K/M/D/U 같은 비율값도 이 컬럼에 함께 저장되므로 정수부보다 소수부 정밀도가 중요하다.
    Value             DECIMAL(38,10) NULL,
    TextValue         NVARCHAR(2000) NULL,
    CONSTRAINT FK_WebProfitReportConfirmDetail_Confirm
      FOREIGN KEY (ConfirmKey) REFERENCES dbo.WebProfitReportConfirm(ConfirmKey)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirmDetail')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirmDetail
  ON dbo.WebProfitReportConfirmDetail(ConfirmKey, Category, ColType, ColKey);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebProfitReportConfirmDetail_Confirm')
  CREATE INDEX IX_WebProfitReportConfirmDetail_Confirm
  ON dbo.WebProfitReportConfirmDetail(ConfirmKey);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirmDetail_ColType')
  ALTER TABLE dbo.WebProfitReportConfirmDetail WITH NOCHECK
  ADD CONSTRAINT CK_WebProfitReportConfirmDetail_ColType
  CHECK (ColType IN (N'SOURCE', N'CALC', N'SOURCE_TAG'));

-- ============================================================================
-- 3. FreightCost 통화 검증 호환 컬럼 (2026-08-11)
--
-- 전산 호환 분석:
--   FreightCost 는 2026-04-16 "운송기준원가" 웹 전용 신규 기능으로 만들어진 테이블이며
--   (docs/migrations/2026-04-16_freight_cost.sql), nenova.exe 가 이 테이블에 INSERT/
--   UPDATE 하는 경로는 발견되지 않았다(신규 웹 기능 전용, 기존 ERP 공유 테이블 아님).
--   다만 안전을 위해 "컬럼 추가 = NULL 허용, NOT NULL 강제 금지" 원칙을 그대로 지킨다.
--
--   실제 컬럼 구조 확인 방법 (이번 세션 — 운영 DB 접속 불가, .env.local 없음):
--     1) docs/migrations/2026-04-16_freight_cost.sql 의 CREATE TABLE FreightCost 정의
--        (FreightKey, WarehouseKey, WeightBasis, ExchangeRate, GrossWeight,
--         ChargeableWeight, FreightRateUSD, DocFeeUSD, InvoiceTotalUSD,
--         BakSangRate, HandlingFee, QuarantinePerItem, DomesticFreight, DeductFee,
--         ExtraFee, CreateID, CreateDtm, UpdateID, UpdateDtm, isDeleted) 를 원본으로 사용.
--     2) docs/DB_STRUCTURE.md §1.5 FreightCost 설명과 대조하여 위 2026-04-16 정의 이후
--        컬럼 변경 이력이 없음을 확인(다른 migrations/*.sql 에 FreightCost ALTER 없음).
--     3) scripts/preview-migrate-2026-08-11-profit-report-confirm.mjs 는 .env.local 이
--        있는 환경에서 INFORMATION_SCHEMA.COLUMNS 를 SELECT 전용으로 조회해 실제 컬럼과
--        비교하는 사전 점검을 제공한다(이번 세션에서는 접속 정보가 없어 실행하지 않았다).
--
--   현재 FreightCost 에는 통화코드(CurrencyCode) 컬럼이 없다 — 환율은 WarehouseKey(BILL)
--   1건당 ExchangeRate 하나뿐이며 통화 종류는 암묵적으로 BILL/국가에서 추론되어 왔다.
--   아래 컬럼은 그 통화가 AUD/EUR/CNY/JPY/USD 중 무엇인지, 그리고 검증되었는지를
--   명시적으로 표시하기 위한 것이다.
--
--   안전 패턴 (CLAUDE 마이그레이션 규칙): NOT NULL 컬럼을 곧바로 추가하지 않는다.
--     1) NULL 허용으로 컬럼만 먼저 추가
--     2) 기존 행은 "검증 안 됨" 상태로만 표시(UPDATE ... WHERE 컬럼 IS NULL — 값 추측 없음)
--     3) (선택, 이번 마이그레이션에 포함하지 않음) 충분히 검증된 뒤 NOT NULL 전환은 별도 승인 필요
-- ============================================================================
IF COL_LENGTH('FreightCost', 'CurrencyCode') IS NULL
  ALTER TABLE FreightCost ADD CurrencyCode NVARCHAR(10) NULL;  -- AUD/EUR/CNY/JPY/USD 중 하나, 모르면 NULL

IF COL_LENGTH('FreightCost', 'CurrencyValidationStatus') IS NULL
  ALTER TABLE FreightCost ADD CurrencyValidationStatus NVARCHAR(20) NULL;  -- 'validated' | 'legacy_unverified'

-- 백필: 새 컬럼이 막 추가되어 값이 없는 기존(레거시) 행만 상태 라벨을 채운다.
-- CurrencyCode(실제 통화)는 추측하지 않고 NULL로 남긴다 — 값 backfill 아님, 상태 라벨만 부여.
UPDATE FreightCost
   SET CurrencyValidationStatus = N'legacy_unverified'
 WHERE CurrencyValidationStatus IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FreightCost_CurrencyCode')
  ALTER TABLE FreightCost WITH NOCHECK
  ADD CONSTRAINT CK_FreightCost_CurrencyCode
  CHECK (CurrencyCode IS NULL OR CurrencyCode IN (N'AUD', N'EUR', N'CNY', N'JPY', N'USD'));

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FreightCost_CurrencyValidationStatus')
  ALTER TABLE FreightCost WITH NOCHECK
  ADD CONSTRAINT CK_FreightCost_CurrencyValidationStatus
  CHECK (CurrencyValidationStatus IS NULL OR CurrencyValidationStatus IN (N'validated', N'legacy_unverified'));

-- ─────────────────────────────────────────────────────────────────────────
-- 검증 쿼리 (읽기 전용 — 운영 실행 시 이 파일 실행 뒤 수동으로 돌려볼 것)
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) AS activeConfirmCount, OrderYear, MajorWeek
--   FROM WebProfitReportConfirm WHERE IsActive=1 GROUP BY OrderYear, MajorWeek HAVING COUNT(*) > 1; -- 0건이어야 정상
-- SELECT TOP 20 * FROM WebProfitReportConfirm ORDER BY ConfirmKey DESC;
-- SELECT TOP 50 * FROM WebProfitReportConfirmDetail ORDER BY ConfirmDetailKey DESC;
-- SELECT CurrencyValidationStatus, COUNT(*) FROM FreightCost GROUP BY CurrencyValidationStatus;
-- SELECT TOP 20 FreightKey, WarehouseKey, ExchangeRate, CurrencyCode, CurrencyValidationStatus FROM FreightCost ORDER BY FreightKey DESC;
