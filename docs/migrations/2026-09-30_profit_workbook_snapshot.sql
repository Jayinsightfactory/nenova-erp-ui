-- 매출원가 양식 원천시트 스냅샷(웹 전용). ERP 원장 side effect 없음.
-- 행은 불변: 수정은 새 버전(VersionNo) INSERT로만 한다. 트리거가 UPDATE/DELETE를 차단한다.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ProfitWorkbookSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProfitWorkbookSnapshot (
    SnapshotKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProfitWorkbookSnapshot PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    VersionNo INT NOT NULL,
    Kind NVARCHAR(20) NOT NULL,
    BaseSnapshotKey INT NULL,
    CreatedBy NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProfitWorkbookSnapshot_CreatedAt DEFAULT (SYSUTCDATETIME()),
    RowCnt INT NOT NULL,
    TotalsJson NVARCHAR(MAX) NULL,
    SourceHash NVARCHAR(128) NULL,
    Note NVARCHAR(500) NULL,
    CONSTRAINT UX_ProfitWorkbookSnapshot_Version UNIQUE (OrderYear, MajorWeek, VersionNo),
    CONSTRAINT CK_ProfitWorkbookSnapshot_Kind CHECK (Kind IN (N'CONFIRM', N'REFRESH', N'EDIT'))
  );
END;

IF OBJECT_ID(N'dbo.ProfitWorkbookSnapshotRow', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProfitWorkbookSnapshotRow (
    SnapshotKey INT NOT NULL,
    Sheet NVARCHAR(20) NOT NULL,
    RowKey NVARCHAR(100) NOT NULL,
    SortNo INT NOT NULL,
    IsManual BIT NOT NULL CONSTRAINT DF_ProfitWorkbookSnapshotRow_IsManual DEFAULT (0),
    DataJson NVARCHAR(MAX) NOT NULL,
    ManualJson NVARCHAR(MAX) NULL,
    ManualBy NVARCHAR(100) NULL,
    ManualAt NVARCHAR(40) NULL,
    CONSTRAINT PK_ProfitWorkbookSnapshotRow PRIMARY KEY (SnapshotKey, Sheet, RowKey),
    CONSTRAINT FK_ProfitWorkbookSnapshotRow_Snapshot FOREIGN KEY (SnapshotKey) REFERENCES dbo.ProfitWorkbookSnapshot (SnapshotKey)
  );
END;

IF OBJECT_ID(N'dbo.TR_ProfitWorkbookSnapshot_Immutable', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER dbo.TR_ProfitWorkbookSnapshot_Immutable ON dbo.ProfitWorkbookSnapshot INSTEAD OF UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; THROW 50031, ''ProfitWorkbookSnapshot is immutable (insert a new version).'', 1; END');

IF OBJECT_ID(N'dbo.TR_ProfitWorkbookSnapshotRow_Immutable', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER dbo.TR_ProfitWorkbookSnapshotRow_Immutable ON dbo.ProfitWorkbookSnapshotRow INSTEAD OF UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; THROW 50032, ''ProfitWorkbookSnapshotRow is immutable (insert a new version).'', 1; END');

COMMIT;
