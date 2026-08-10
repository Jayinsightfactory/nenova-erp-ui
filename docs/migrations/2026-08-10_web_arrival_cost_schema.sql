-- 도착원가 웹 전용 원장.
-- lib/arrivalCost.js의 기존 ensure DDL과 동일하며 반복 실행할 수 있다.
IF OBJECT_ID(N'dbo.WebArrivalCostImport', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebArrivalCostImport (
    ImportKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    UploadFileName NVARCHAR(260) NOT NULL DEFAULT N'',
    RevisionNo INT NOT NULL DEFAULT 1,
    ScopeJson NVARCHAR(MAX) NULL,
    UploadedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    UploadedByName NVARCHAR(100) NOT NULL DEFAULT N'',
    UploadedAt DATETIME NOT NULL DEFAULT GETDATE(),
    IsDeleted BIT NOT NULL DEFAULT 0
  );
  CREATE INDEX IX_WebArrivalCostImport_Year ON dbo.WebArrivalCostImport(OrderYear, UploadedAt DESC);
END;

IF OBJECT_ID(N'dbo.WebArrivalCostLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebArrivalCostLine (
    ArrivalLineKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ImportKey INT NOT NULL,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL DEFAULT N'',
    CountryName NVARCHAR(100) NOT NULL DEFAULT N'',
    FlowerNameRaw NVARCHAR(200) NOT NULL DEFAULT N'',
    ProductNameRaw NVARCHAR(300) NOT NULL DEFAULT N'',
    FarmNameRaw NVARCHAR(200) NOT NULL DEFAULT N'',
    ProdKey INT NULL,
    FarmKey INT NULL,
    Unit NVARCHAR(40) NOT NULL DEFAULT N'',
    Quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
    FobUSD DECIMAL(18,6) NULL,
    FreightPerUnitUSD DECIMAL(18,6) NULL,
    CustomsPerUnitKRW DECIMAL(18,4) NULL,
    OtherPerUnitKRW DECIMAL(18,4) NULL,
    SourceArrivalCostKRW DECIMAL(18,4) NULL,
    SourceArrivalCostVatKRW DECIMAL(18,4) NULL,
    SelectedArrivalCostKRW DECIMAL(18,4) NULL,
    ExchangeRate DECIMAL(18,6) NULL,
    GrossWeight DECIMAL(18,4) NULL,
    ChargeableWeight DECIMAL(18,4) NULL,
    FreightUSD DECIMAL(18,6) NULL,
    InvoiceUSD DECIMAL(18,6) NULL,
    WeightMetricShare DECIMAL(18,8) NULL,
    VolumeMetricShare DECIMAL(18,8) NULL,
    ValueMetricShare DECIMAL(18,8) NULL,
    AllocationBasis NVARCHAR(20) NOT NULL DEFAULT N'SOURCE',
    MatchStatus NVARCHAR(30) NOT NULL DEFAULT N'PRODUCT_REQUIRED',
    SourceFileName NVARCHAR(260) NOT NULL DEFAULT N'',
    SheetName NVARCHAR(120) NOT NULL DEFAULT N'',
    SourceRow INT NULL,
    RawJson NVARCHAR(MAX) NULL,
    Notes NVARCHAR(1000) NOT NULL DEFAULT N'',
    IsCurrent BIT NOT NULL DEFAULT 1,
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebArrivalCostLine_Current ON dbo.WebArrivalCostLine(OrderYear, OrderWeek, CountryName, IsCurrent);
  CREATE INDEX IX_WebArrivalCostLine_Product ON dbo.WebArrivalCostLine(ProdKey, FarmKey, IsCurrent);
END;

IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'WeightMetricShare') IS NULL
  ALTER TABLE dbo.WebArrivalCostLine ADD WeightMetricShare DECIMAL(18,8) NULL;
IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'VolumeMetricShare') IS NULL
  ALTER TABLE dbo.WebArrivalCostLine ADD VolumeMetricShare DECIMAL(18,8) NULL;
IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'ValueMetricShare') IS NULL
  ALTER TABLE dbo.WebArrivalCostLine ADD ValueMetricShare DECIMAL(18,8) NULL;

IF OBJECT_ID(N'dbo.WebArrivalCostHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebArrivalCostHistory (
    HistoryKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ArrivalLineKey INT NULL,
    ImportKey INT NULL,
    ActionType NVARCHAR(30) NOT NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NULL,
    ChangedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    ChangedByName NVARCHAR(100) NOT NULL DEFAULT N'',
    ChangedAt DATETIME NOT NULL DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebArrivalCostHistory_Line ON dbo.WebArrivalCostHistory(ArrivalLineKey, ChangedAt DESC);
END;
