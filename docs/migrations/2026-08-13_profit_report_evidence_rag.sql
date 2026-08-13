SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebProfitReport', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitReport (
    AutoKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebProfitReport PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    Category NVARCHAR(60) NOT NULL,
    ColKey NVARCHAR(20) NOT NULL,
    Value FLOAT NULL,
    TextValue NVARCHAR(2000) NULL,
    SourceRef NVARCHAR(500) NULL,
    EffectiveAt DATETIME2 NULL,
    ConfirmedBy NVARCHAR(100) NULL,
    ConfirmedAt DATETIME2 NULL,
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebProfitReport_UpdatedAt DEFAULT GETDATE()
  );
END;
IF COL_LENGTH(N'dbo.WebProfitReport', N'SourceRef') IS NULL ALTER TABLE dbo.WebProfitReport ADD SourceRef NVARCHAR(500) NULL;
IF COL_LENGTH(N'dbo.WebProfitReport', N'EffectiveAt') IS NULL ALTER TABLE dbo.WebProfitReport ADD EffectiveAt DATETIME2 NULL;
IF COL_LENGTH(N'dbo.WebProfitReport', N'ConfirmedBy') IS NULL ALTER TABLE dbo.WebProfitReport ADD ConfirmedBy NVARCHAR(100) NULL;
IF COL_LENGTH(N'dbo.WebProfitReport', N'ConfirmedAt') IS NULL ALTER TABLE dbo.WebProfitReport ADD ConfirmedAt DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebProfitReport') AND name=N'UX_WebProfitReport')
  CREATE UNIQUE INDEX UX_WebProfitReport ON dbo.WebProfitReport(OrderYear, MajorWeek, Category, ColKey);

IF OBJECT_ID(N'dbo.WebStockPriceEvidence', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebStockPriceEvidence (
    EvidenceKey BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebStockPriceEvidence PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    ProdKey INT NOT NULL,
    Price FLOAT NOT NULL,
    SourceRef NVARCHAR(500) NOT NULL,
    EffectiveAt DATETIME2 NOT NULL,
    ConfirmedBy NVARCHAR(100) NOT NULL,
    ConfirmedAt DATETIME2 NOT NULL,
    EvidenceStatus NVARCHAR(20) NOT NULL,
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebStockPriceEvidence_UpdatedAt DEFAULT GETDATE(),
    CONSTRAINT CK_WebStockPriceEvidence_Status CHECK (EvidenceStatus IN (N'VERIFIED', N'REVOKED'))
  );
  CREATE UNIQUE INDEX UX_WebStockPriceEvidence_PerSnapshot
    ON dbo.WebStockPriceEvidence(OrderYear, OrderWeek, ProdKey);
END;

IF OBJECT_ID(N'dbo.WebCustomsRateConfig', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebCustomsRateConfig (
    ConfigKey NVARCHAR(40) NOT NULL CONSTRAINT PK_WebCustomsRateConfig PRIMARY KEY,
    Value FLOAT NOT NULL,
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebCustomsRateConfig_UpdatedAt DEFAULT GETDATE()
  );
END;

IF OBJECT_ID(N'dbo.WebCustomsWeekly', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebCustomsWeekly (
    AutoKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebCustomsWeekly PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL, Category NVARCHAR(60) NOT NULL,
    GW1 FLOAT NULL, GW2 FLOAT NULL, Customs1 FLOAT NULL, Customs2 FLOAT NULL,
    SunYul1 FLOAT NULL, SunYul2 FLOAT NULL, WorldFreight1 FLOAT NULL, WorldFreight2 FLOAT NULL,
    Quarantine1 FLOAT NULL, Quarantine2 FLOAT NULL,
    WorldFreight1Manual BIT NULL, WorldFreight2Manual BIT NULL,
    BakSangRateApplied FLOAT NULL,
    Customs1_1 FLOAT NULL, Customs1_2 FLOAT NULL, Customs1_3 FLOAT NULL,
    Customs2_1 FLOAT NULL, Customs2_2 FLOAT NULL, Customs2_3 FLOAT NULL,
    SunYul1_1 FLOAT NULL, SunYul1_2 FLOAT NULL, SunYul1_3 FLOAT NULL,
    SunYul2_1 FLOAT NULL, SunYul2_2 FLOAT NULL, SunYul2_3 FLOAT NULL,
    UpdatedBy NVARCHAR(50) NULL, UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebCustomsWeekly_UpdatedAt DEFAULT GETDATE()
  );
END;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'WorldFreight1Manual') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD WorldFreight1Manual BIT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'WorldFreight2Manual') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD WorldFreight2Manual BIT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'BakSangRateApplied') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD BakSangRateApplied FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs1_1') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs1_1 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs1_2') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs1_2 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs1_3') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs1_3 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs2_1') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs2_1 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs2_2') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs2_2 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'Customs2_3') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD Customs2_3 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul1_1') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul1_1 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul1_2') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul1_2 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul1_3') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul1_3 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul2_1') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul2_1 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul2_2') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul2_2 FLOAT NULL;
IF COL_LENGTH(N'dbo.WebCustomsWeekly', N'SunYul2_3') IS NULL ALTER TABLE dbo.WebCustomsWeekly ADD SunYul2_3 FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebCustomsWeekly') AND name=N'UX_WebCustomsWeekly')
  CREATE UNIQUE INDEX UX_WebCustomsWeekly ON dbo.WebCustomsWeekly(OrderYear, MajorWeek, Category);

IF OBJECT_ID(N'dbo.WebColombiaWeekly', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebColombiaWeekly (
    AutoKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebColombiaWeekly PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL, OrderWeek NVARCHAR(10) NOT NULL,
    GW FLOAT NULL, CW FLOAT NULL, HandlingFee FLOAT NULL, ItemCount FLOAT NULL,
    Truck1t FLOAT NULL, Truck2_5t FLOAT NULL, Truck5t FLOAT NULL,
    CustomsFee FLOAT NULL, DisinfectFee FLOAT NULL, QuarantineDeductFee FLOAT NULL, AirRateUSD FLOAT NULL,
    BakSangRateApplied FLOAT NULL,
    UpdatedBy NVARCHAR(50) NULL, UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebColombiaWeekly_UpdatedAt DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_WebColombiaWeekly ON dbo.WebColombiaWeekly(OrderYear, OrderWeek);
END;
IF COL_LENGTH(N'dbo.WebColombiaWeekly', N'BakSangRateApplied') IS NULL ALTER TABLE dbo.WebColombiaWeekly ADD BakSangRateApplied FLOAT NULL;

IF OBJECT_ID(N'dbo.WebForwardingWeekly', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebForwardingWeekly (
    AutoKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebForwardingWeekly PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL, Category NVARCHAR(60) NOT NULL,
    AmountUSD FLOAT NULL,
    UpdatedBy NVARCHAR(50) NULL, UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebForwardingWeekly_UpdatedAt DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_WebForwardingWeekly ON dbo.WebForwardingWeekly(OrderYear, MajorWeek, Category);
END;

IF OBJECT_ID(N'dbo.WebCustomsHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebCustomsHistory (
    HistoryKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebCustomsHistory PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL, ScopeType NVARCHAR(20) NOT NULL, ScopeKey NVARCHAR(60) NOT NULL,
    FieldName NVARCHAR(40) NOT NULL, OldValue FLOAT NULL, NewValue FLOAT NULL,
    ChangedBy NVARCHAR(50) NULL, ChangedAt DATETIME NOT NULL CONSTRAINT DF_WebCustomsHistory_ChangedAt DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebCustomsHistory_Scope ON dbo.WebCustomsHistory(ScopeType, ScopeKey);
END;

COMMIT TRANSACTION;
