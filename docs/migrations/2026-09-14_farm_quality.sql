SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.WebFarmQualityCase',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WebFarmQualityCase (
 CaseKey UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
 OrderYear INT NOT NULL, SourceKey INT NOT NULL, ProdKey INT NOT NULL,
 FarmName NVARCHAR(200) NOT NULL, FarmKey INT NULL, ProductName NVARCHAR(300) NOT NULL,
 Title NVARCHAR(200) NOT NULL, Status NVARCHAR(20) NOT NULL,
 DueDate DATE NULL, AppliedWeek INT NULL, Version INT NOT NULL DEFAULT 1,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CreatedBy NVARCHAR(100) NOT NULL, CreatedByName NVARCHAR(100) NOT NULL,
 CreateRequest UNIQUEIDENTIFIER NOT NULL UNIQUE
 );
 CREATE INDEX IX_WebFarmQualityCase_Year ON dbo.WebFarmQualityCase(OrderYear,UpdatedAt);
END;
IF OBJECT_ID(N'dbo.WebFarmQualityEvent',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WebFarmQualityEvent (
 EventKey BIGINT IDENTITY PRIMARY KEY, CaseKey UNIQUEIDENTIFIER NOT NULL,
 RequestKey UNIQUEIDENTIFIER NOT NULL UNIQUE, PayloadHash CHAR(64) NOT NULL,
 Kind NVARCHAR(20) NOT NULL, Body NVARCHAR(4000) NOT NULL,
 AuthorId NVARCHAR(100) NOT NULL, AuthorName NVARCHAR(100) NOT NULL, Department NVARCHAR(100) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 BeforeStatus NVARCHAR(20) NULL, AfterStatus NVARCHAR(20) NOT NULL,
 EventDate DATE NULL, DueDate DATE NULL, AppliedWeek INT NULL,
 CONSTRAINT FK_WebFarmQualityEvent_Case FOREIGN KEY(CaseKey) REFERENCES dbo.WebFarmQualityCase(CaseKey)
 );
 CREATE INDEX IX_WebFarmQualityEvent_Case ON dbo.WebFarmQualityEvent(CaseKey,EventKey);
END;
IF OBJECT_ID(N'dbo.WebFarmQualityEvidence',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WebFarmQualityEvidence (
 EvidenceKey UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
 OrderYear INT NOT NULL,
 EventKey BIGINT NULL,
 FileName NVARCHAR(200) NOT NULL,
 MimeType NVARCHAR(40) NOT NULL,
 ByteSize INT NOT NULL,
 Content VARBINARY(MAX) NOT NULL,
 CreatedBy NVARCHAR(100) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 ExpiresAt DATETIME2 NOT NULL,
 CONSTRAINT FK_WebFarmQualityEvidence_Event FOREIGN KEY(EventKey) REFERENCES dbo.WebFarmQualityEvent(EventKey)
 );
 CREATE INDEX IX_WebFarmQualityEvidence_Event ON dbo.WebFarmQualityEvidence(EventKey,EvidenceKey);
 CREATE INDEX IX_WebFarmQualityEvidence_Draft ON dbo.WebFarmQualityEvidence(OrderYear,CreatedBy,ExpiresAt) WHERE EventKey IS NULL;
END;
IF OBJECT_ID(N'dbo.WebFarmQualityInbox',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WebFarmQualityInbox (
  InboxKey UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, OrderYear INT NOT NULL,
  Version INT NOT NULL DEFAULT 1, Excluded BIT NOT NULL DEFAULT 0,
  ExclusionReason NVARCHAR(1000) NULL, ExcludedAt DATETIME2 NULL, ExcludedBy NVARCHAR(100) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), CreatedBy NVARCHAR(100) NOT NULL,
  CONSTRAINT UQ_WebFarmQualityInbox_Year UNIQUE(InboxKey,OrderYear)
 );
END;
IF COL_LENGTH(N'dbo.WebFarmQualityCase',N'InboxKey') IS NULL
 ALTER TABLE dbo.WebFarmQualityCase ADD InboxKey UNIQUEIDENTIFIER NULL;
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name=N'FK_WebFarmQualityCase_Inbox')
 EXEC(N'ALTER TABLE dbo.WebFarmQualityCase ADD CONSTRAINT FK_WebFarmQualityCase_Inbox FOREIGN KEY(InboxKey,OrderYear) REFERENCES dbo.WebFarmQualityInbox(InboxKey,OrderYear)');
IF OBJECT_ID(N'dbo.WebFarmQualityInboxSource',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.WebFarmQualityInboxSource (
  OrderYear INT NOT NULL, SourceKey INT NOT NULL, InboxKey UNIQUEIDENTIFIER NOT NULL,
  LinkedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), LinkedEventKey BIGINT NOT NULL,
  CONSTRAINT PK_WebFarmQualityInboxSource PRIMARY KEY(OrderYear,SourceKey),
  CONSTRAINT FK_WebFarmQualityInboxSource_Inbox FOREIGN KEY(InboxKey,OrderYear) REFERENCES dbo.WebFarmQualityInbox(InboxKey,OrderYear),
  CONSTRAINT FK_WebFarmQualityInboxSource_Event FOREIGN KEY(LinkedEventKey) REFERENCES dbo.WebFarmQualityEvent(EventKey)
 );
 CREATE INDEX IX_WebFarmQualityInboxSource_Inbox ON dbo.WebFarmQualityInboxSource(InboxKey);
END;
COMMIT;
