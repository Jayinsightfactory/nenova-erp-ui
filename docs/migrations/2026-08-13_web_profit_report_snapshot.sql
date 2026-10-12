SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReportSnapshot (
    SnapshotKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebProfitReportSnapshot PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    State NVARCHAR(20) NOT NULL,
    SourceType NVARCHAR(30) NOT NULL,
    SourceRef NVARCHAR(500) NULL,
    SourceSha256 NVARCHAR(64) NULL,
    PayloadVersion INT NOT NULL,
    PayloadJson NVARCHAR(MAX) NOT NULL,
    ConfirmedBy NVARCHAR(100) NULL,
    ConfirmedAt DATETIME2 NOT NULL CONSTRAINT DF_WebProfitReportSnapshot_ConfirmedAt DEFAULT SYSDATETIME()
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id=OBJECT_ID(N'dbo.WebProfitReportSnapshot')
     AND name=N'UX_WebProfitReportSnapshot_Confirmed'
)
BEGIN
  CREATE UNIQUE INDEX UX_WebProfitReportSnapshot_Confirmed
    ON dbo.WebProfitReportSnapshot(OrderYear, MajorWeek)
    WHERE State=N'CONFIRMED';
END;

COMMIT TRANSACTION;
