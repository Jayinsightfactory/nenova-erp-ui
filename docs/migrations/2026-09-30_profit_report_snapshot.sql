-- 주차별 매출이익 보고서 계산 결과 스냅샷(웹 전용). ERP 원장 side effect 없음.
-- 행은 불변: 재계산은 새 버전(VersionNo) INSERT 로만 한다. 트리거가 UPDATE/DELETE 를 차단한다.
-- 함께: 보고서 기준 확정(WebProfitReportConfirm/Detail) 웹 전용 테이블 — 운영에 없어 확정 기능이 동작하지 않던 문제 수정.
--       (2026-08-11 마이그레이션의 FreightCost ALTER 는 ERP 공유 테이블이라 여기 포함하지 않는다.)
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportSnapshot (
    SnapKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebProfitReportSnapshot PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    VersionNo INT NOT NULL,
    CalcVersion NVARCHAR(60) NOT NULL,
    FingerprintHash NVARCHAR(64) NOT NULL,
    FingerprintJson NVARCHAR(MAX) NOT NULL,
    PayloadJson NVARCHAR(MAX) NOT NULL,
    PayloadHash NVARCHAR(64) NOT NULL,
    PrevPayloadHash NVARCHAR(64) NULL,
    Reason NVARCHAR(20) NOT NULL,
    ChangedFromPrev BIT NOT NULL CONSTRAINT DF_WebProfitReportSnapshot_Changed DEFAULT (1),
    ComputeMs INT NULL,
    CreatedBy NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebProfitReportSnapshot_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UX_WebProfitReportSnapshot_Version UNIQUE (OrderYear, MajorWeek, VersionNo)
  );
END;

IF OBJECT_ID(N'dbo.TR_WebProfitReportSnapshot_Immutable', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER dbo.TR_WebProfitReportSnapshot_Immutable ON dbo.WebProfitReportSnapshot INSTEAD OF UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; THROW 50041, ''WebProfitReportSnapshot is immutable (insert a new version).'', 1; END');

IF OBJECT_ID(N'dbo.WebProfitReportConfirm', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportConfirm (
    ConfirmKey        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear         NVARCHAR(4)  NOT NULL,
    MajorWeek         NVARCHAR(4)  NOT NULL,
    RevisionNo        INT          NOT NULL DEFAULT 1,
    IsActive          BIT          NOT NULL DEFAULT 1,
    BeginOrderYear    NVARCHAR(4)  NULL,
    BeginOrderWeek    NVARCHAR(10) NULL,
    BeginStockKey     INT          NULL,
    EndOrderYear      NVARCHAR(4)  NULL,
    EndOrderWeek      NVARCHAR(10) NULL,
    EndStockKey       INT          NULL,
    SourceHash        NVARCHAR(128) NULL,
    AuditStatus       NVARCHAR(20)  NULL,
    AuditIssuesJson   NVARCHAR(MAX) NULL,
    IsForced          BIT           NOT NULL DEFAULT 0,
    ForceReason       NVARCHAR(1000) NULL,
    ConfirmedBy       NVARCHAR(50)  NULL,
    ConfirmedByName   NVARCHAR(100) NULL,
    ConfirmedAt       DATETIME      NOT NULL DEFAULT GETDATE(),
    CancelledBy       NVARCHAR(50)  NULL,
    CancelledByName   NVARCHAR(100) NULL,
    CancelledAt       DATETIME      NULL,
    Notes             NVARCHAR(2000) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_ActiveWeek')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirm_ActiveWeek ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek) WHERE IsActive = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_Revision')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirm_Revision ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek, RevisionNo);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirm_AuditStatus')
  ALTER TABLE dbo.WebProfitReportConfirm WITH NOCHECK ADD CONSTRAINT CK_WebProfitReportConfirm_AuditStatus
  CHECK (AuditStatus IS NULL OR AuditStatus IN (N'ready', N'needs_review', N'needs_input'));

IF OBJECT_ID(N'dbo.WebProfitReportConfirmDetail', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportConfirmDetail (
    ConfirmDetailKey  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ConfirmKey        INT          NOT NULL,
    Category          NVARCHAR(60) NOT NULL,
    ColType           NVARCHAR(12) NOT NULL,
    ColKey            NVARCHAR(20) NOT NULL,
    Value             DECIMAL(38,10) NULL,
    TextValue         NVARCHAR(2000) NULL,
    CONSTRAINT FK_WebProfitReportConfirmDetail_Confirm FOREIGN KEY (ConfirmKey) REFERENCES dbo.WebProfitReportConfirm(ConfirmKey)
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirmDetail')
  CREATE UNIQUE INDEX UX_WebProfitReportConfirmDetail ON dbo.WebProfitReportConfirmDetail(ConfirmKey, Category, ColType, ColKey);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebProfitReportConfirmDetail_Confirm')
  CREATE INDEX IX_WebProfitReportConfirmDetail_Confirm ON dbo.WebProfitReportConfirmDetail(ConfirmKey);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirmDetail_ColType')
  ALTER TABLE dbo.WebProfitReportConfirmDetail WITH NOCHECK ADD CONSTRAINT CK_WebProfitReportConfirmDetail_ColType
  CHECK (ColType IN (N'SOURCE', N'CALC', N'SOURCE_TAG'));

COMMIT;
