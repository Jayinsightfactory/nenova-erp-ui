SET XACT_ABORT ON;
BEGIN TRANSACTION;
/*
  Web-only edit presence sidecar.  It deliberately does not alter Nenova ERP
  tables or triggers.  Apply once through the deployment migration runner.
*/
IF OBJECT_ID(N'dbo.WebErpEditLease', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebErpEditLease (
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(16) NOT NULL,
    CustKey INT NOT NULL,
    LeaseToken NVARCHAR(64) NOT NULL,
    OwnerUserId NVARCHAR(100) NOT NULL,
    OwnerName NVARCHAR(200) NOT NULL,
    ClientId NVARCHAR(128) NOT NULL,
    PageCode NVARCHAR(80) NOT NULL,
    BaselineDigest CHAR(64) NOT NULL,
    Revision INT NOT NULL CONSTRAINT DF_WebErpEditLease_Revision DEFAULT (0),
    AcquiredAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebErpEditLease_AcquiredAt DEFAULT SYSUTCDATETIME(),
    HeartbeatAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebErpEditLease_HeartbeatAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt DATETIME2(3) NOT NULL,
    CONSTRAINT PK_WebErpEditLease PRIMARY KEY (OrderYear, OrderWeek, CustKey)
  );
END;

IF COL_LENGTH(N'dbo.WebErpEditLease', N'BaselineDigest') IS NULL
BEGIN
  ALTER TABLE dbo.WebErpEditLease ADD BaselineDigest CHAR(64) NULL;
  /* Existing browser leases must explicitly refresh once; never guess their baseline. */
  UPDATE dbo.WebErpEditLease
     SET BaselineDigest = REPLICATE('0', 64)
   WHERE BaselineDigest IS NULL;
  ALTER TABLE dbo.WebErpEditLease ALTER COLUMN BaselineDigest CHAR(64) NOT NULL;
END;

IF COL_LENGTH(N'dbo.WebErpEditLease', N'Revision') IS NULL
BEGIN
  ALTER TABLE dbo.WebErpEditLease
    ADD Revision INT NOT NULL CONSTRAINT DF_WebErpEditLease_Revision_Existing DEFAULT (0);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id = OBJECT_ID(N'dbo.WebErpEditLease')
     AND name = N'IX_WebErpEditLease_ExpiresAt'
)
BEGIN
  CREATE INDEX IX_WebErpEditLease_ExpiresAt
    ON dbo.WebErpEditLease (ExpiresAt)
    INCLUDE (OwnerUserId, OwnerName, ClientId, PageCode);
END;

COMMIT TRANSACTION;
