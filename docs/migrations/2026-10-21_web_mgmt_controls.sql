-- 경영관리(mgmt) 웹 전용 스키마. lib/mgmt/schema.js ensure DDL과 동일하며 반복 실행 가능.
-- dbo ERP 원장·ecount_work 스키마는 건드리지 않는다.
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'web_mgmt') EXEC(N'CREATE SCHEMA web_mgmt');

-- ① 여신한도: 추가 전용 이력. 현재값 = 거래처별 최신 행.
IF OBJECT_ID(N'web_mgmt.CreditLimitHistory', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.CreditLimitHistory (
    HistoryKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CustKey INT NOT NULL,
    LimitKRW DECIMAL(18,0) NOT NULL,
    Reason NVARCHAR(400) NOT NULL DEFAULT N'',
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtCreditLimit_Cust ON web_mgmt.CreditLimitHistory(CustKey, CreatedAt DESC);
END;

-- ⑥ 단가 변경이력: 웹 단가 변경 시 전·후 값 기록(추가 전용).
IF OBJECT_ID(N'web_mgmt.PriceChangeHistory', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.PriceChangeHistory (
    HistoryKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CustKey INT NULL,
    ProdKey INT NOT NULL,
    PriceKind NVARCHAR(40) NOT NULL DEFAULT N'',
    BeforeValue DECIMAL(18,4) NULL,
    AfterValue DECIMAL(18,4) NULL,
    Source NVARCHAR(60) NOT NULL DEFAULT N'web',
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtPriceChange_Prod ON web_mgmt.PriceChangeHistory(ProdKey, CreatedAt DESC);
END;

-- ⑦ 클레임 사유코드 사전 + 불량차감 행과의 연결.
IF OBJECT_ID(N'web_mgmt.ClaimReasonCode', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.ClaimReasonCode (
    Code NVARCHAR(20) NOT NULL PRIMARY KEY,
    Label NVARCHAR(100) NOT NULL,
    Category NVARCHAR(40) NOT NULL DEFAULT N'',
    SortOrder INT NOT NULL DEFAULT 0,
    IsActive BIT NOT NULL DEFAULT 1
  );
END;
IF OBJECT_ID(N'web_mgmt.ClaimReasonLink', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.ClaimReasonLink (
    LinkKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    SourceTable NVARCHAR(60) NOT NULL,
    SourceKey NVARCHAR(100) NOT NULL,
    Code NVARCHAR(20) NOT NULL,
    Note NVARCHAR(400) NOT NULL DEFAULT N'',
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtClaimLink_Source ON web_mgmt.ClaimReasonLink(SourceTable, SourceKey);
END;

-- ⑨ 거래처별 월 목표.
IF OBJECT_ID(N'web_mgmt.CustomerTarget', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.CustomerTarget (
    TargetKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CustKey INT NOT NULL,
    TargetMonth CHAR(7) NOT NULL, -- 'YYYY-MM'
    TargetSalesKRW DECIMAL(18,0) NULL,
    TargetProfitKRW DECIMAL(18,0) NULL,
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtTarget_Month ON web_mgmt.CustomerTarget(TargetMonth, CustKey, CreatedAt DESC);
END;

-- ⑧ 차수 마감 체크리스트 확인 기록.
IF OBJECT_ID(N'web_mgmt.WeekCloseCheck', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.WeekCloseCheck (
    CheckKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    ItemCode NVARCHAR(40) NOT NULL,
    Status NVARCHAR(12) NOT NULL CONSTRAINT CK_WebMgmtWeekClose_Status CHECK (Status IN ('open','done','skipped')),
    Note NVARCHAR(400) NOT NULL DEFAULT N'',
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtWeekClose_Week ON web_mgmt.WeekCloseCheck(OrderYear, OrderWeek, ItemCode, CreatedAt DESC);
END;

-- ③④⑤ 승인요청(결재선)·대사결과: ECOUNT 이관 Outbox 설계와 같은 상태 의미. 역행·하드삭제 금지.
IF OBJECT_ID(N'web_mgmt.ApprovalRequest', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.ApprovalRequest (
    RequestId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TargetKind NVARCHAR(40) NOT NULL,
    TargetRef NVARCHAR(200) NOT NULL,
    Version INT NOT NULL DEFAULT 1,
    Status NVARCHAR(12) NOT NULL CONSTRAINT CK_WebMgmtApproval_Status CHECK (Status IN ('draft','requested','approved','rejected','applied','cancelled')),
    PayloadJson NVARCHAR(MAX) NULL,
    RequestedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    RequestedAt DATETIME2 NULL,
    DecidedBy NVARCHAR(100) NULL,
    DecidedAt DATETIME2 NULL,
    DecisionNote NVARCHAR(400) NULL,
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtApproval_Target ON web_mgmt.ApprovalRequest(TargetKind, TargetRef, Version DESC);
  CREATE INDEX IX_WebMgmtApproval_Status ON web_mgmt.ApprovalRequest(Status, UpdatedAt DESC);
END;
IF OBJECT_ID(N'web_mgmt.ApprovalAudit', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.ApprovalAudit (
    AuditKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RequestId INT NOT NULL,
    FromStatus NVARCHAR(12) NULL,
    ToStatus NVARCHAR(12) NOT NULL,
    ActorId NVARCHAR(100) NOT NULL DEFAULT N'',
    Note NVARCHAR(400) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_WebMgmtApprovalAudit_Req ON web_mgmt.ApprovalAudit(RequestId, CreatedAt);
END;
EXEC(N'CREATE OR ALTER TRIGGER web_mgmt.ApprovalRequest_NoHardDelete ON web_mgmt.ApprovalRequest INSTEAD OF DELETE AS BEGIN THROW 51101, ''web_mgmt.ApprovalRequest hard delete forbidden: set Status=cancelled'', 1; END');
EXEC(N'CREATE OR ALTER TRIGGER web_mgmt.ApprovalAudit_Immutable ON web_mgmt.ApprovalAudit INSTEAD OF UPDATE, DELETE AS BEGIN THROW 51102, ''web_mgmt.ApprovalAudit is append-only'', 1; END');

-- ③ 입금 대사 결과(은행 거래 ↔ 거래처/채권). 은행 원문은 저장하지 않고 소스 참조만 둔다.
IF OBJECT_ID(N'web_mgmt.ReceiptMatch', N'U') IS NULL
BEGIN
  CREATE TABLE web_mgmt.ReceiptMatch (
    MatchKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Source NVARCHAR(40) NOT NULL,          -- 'erp' | 'ecount_work' | 'bank'
    SourceRef NVARCHAR(200) NOT NULL,      -- 소스 내 거래 식별자(계좌번호 등 민감값 금지)
    CustKey INT NULL,
    AmountKRW DECIMAL(18,0) NOT NULL,
    TxnDate DATE NULL,
    Status NVARCHAR(12) NOT NULL CONSTRAINT CK_WebMgmtReceipt_Status CHECK (Status IN ('candidate','confirmed','rejected')),
    Confidence DECIMAL(5,4) NULL,
    ApprovalRequestId INT NULL,
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE UNIQUE INDEX UX_WebMgmtReceipt_Source ON web_mgmt.ReceiptMatch(Source, SourceRef);
END;
