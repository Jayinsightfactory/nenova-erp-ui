-- 웹 전용 자연어 품목 매칭 이벤트/alias. ERP 원장을 변경하지 않는다.
IF OBJECT_ID(N'dbo.WebProductMatchEvent', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProductMatchEvent (
    MatchEventKey BIGINT IDENTITY(1,1) PRIMARY KEY, TenantKey NVARCHAR(100) NOT NULL,
    OrderYear INT NULL, OrderWeek NVARCHAR(10) NULL, CustKey INT NULL,
    SourceChannel NVARCHAR(50) NOT NULL DEFAULT N'', QueryHash VARBINARY(32) NOT NULL, QueryPreview NVARCHAR(120) NOT NULL DEFAULT N'',
    CountryName NVARCHAR(100) NOT NULL DEFAULT N'', FlowerName NVARCHAR(100) NOT NULL DEFAULT N'', ColorName NVARCHAR(200) NOT NULL DEFAULT N'', Unit NVARCHAR(30) NOT NULL DEFAULT N'',
    EventType NVARCHAR(40) NOT NULL, CandidateProdKeysJson NVARCHAR(MAX) NOT NULL DEFAULT N'[]', CandidateScoresJson NVARCHAR(MAX) NOT NULL DEFAULT N'[]',
    SelectedProdKey INT NULL, ReplacedProdKey INT NULL, ConfirmedByUser BIT NOT NULL DEFAULT 0, AutoSelected BIT NOT NULL DEFAULT 0,
    ModelVersion NVARCHAR(50) NOT NULL, RuleVersion NVARCHAR(50) NOT NULL,
    ActorId NVARCHAR(100) NOT NULL DEFAULT N'', CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_WebProductMatchEvent_Scope ON dbo.WebProductMatchEvent(TenantKey,OrderYear,OrderWeek,CustKey,CreatedAt DESC);
END;
IF OBJECT_ID(N'dbo.WebProductMatchAlias', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProductMatchAlias (
    AliasKey BIGINT IDENTITY(1,1) PRIMARY KEY, TenantKey NVARCHAR(100) NOT NULL,
    CustKey INT NULL, AliasNormalized NVARCHAR(200) NOT NULL, ProdKey INT NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'PROPOSED', ConfirmCount INT NOT NULL DEFAULT 0,
    DistinctConfirmerCount INT NOT NULL DEFAULT 0, PrecisionValue DECIMAL(9,6) NULL,
    ModelVersion NVARCHAR(50) NOT NULL, ApprovedBy NVARCHAR(100) NULL, ApprovedAt DATETIME2 NULL,
    IsDeleted BIT NOT NULL DEFAULT 0, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_WebProductMatchAlias_Search ON dbo.WebProductMatchAlias(TenantKey,CustKey,AliasNormalized,Status,IsDeleted);
END;
