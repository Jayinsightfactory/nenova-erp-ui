SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebCustomsRateHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebCustomsRateHistory (
    AutoKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebCustomsRateHistory PRIMARY KEY,
    ConfigKey NVARCHAR(40) NOT NULL,
    EffectiveOrderYear NVARCHAR(4) NOT NULL,
    EffectiveMajorWeek NVARCHAR(4) NOT NULL,
    Value FLOAT NOT NULL,
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebCustomsRateHistory_UpdatedAt DEFAULT GETDATE()
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id=OBJECT_ID(N'dbo.WebCustomsRateHistory')
     AND name=N'UX_WebCustomsRateHistory_Effective'
)
BEGIN
  CREATE UNIQUE INDEX UX_WebCustomsRateHistory_Effective
    ON dbo.WebCustomsRateHistory(ConfigKey, EffectiveOrderYear, EffectiveMajorWeek);
END;

COMMIT TRANSACTION;
