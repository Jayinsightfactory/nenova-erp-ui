-- 호텔+미우 주문입력: 1차/2차 이력 + 게시판 전용 품목 매칭 overlay
-- Order/Shipment 원장은 만들지 않는다. createOrder(source=hotel-miu-board)가 주문을 가산한다.

IF OBJECT_ID(N'dbo.WebHotelMiuIntakeBatch', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebHotelMiuIntakeBatch (
    BatchKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    CustKey INT NOT NULL,
    BatchNo INT NOT NULL,
    Status NVARCHAR(12) NOT NULL CONSTRAINT DF_WebHotelMiuIntakeBatch_Status DEFAULT N'REGISTERED',
    SourceNote NVARCHAR(200) NOT NULL CONSTRAINT DF_WebHotelMiuIntakeBatch_Note DEFAULT N'',
    CreatedBy NVARCHAR(50) NULL,
    CreatedAt DATETIME NOT NULL CONSTRAINT DF_WebHotelMiuIntakeBatch_CreatedAt DEFAULT GETDATE(),
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebHotelMiuIntakeBatch_UpdatedAt DEFAULT GETDATE(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebHotelMiuIntakeBatch_Deleted DEFAULT 0
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE name = N'UX_WebHotelMiuIntakeBatch_YearWeekCustNo'
     AND object_id = OBJECT_ID(N'dbo.WebHotelMiuIntakeBatch')
)
BEGIN
  CREATE UNIQUE INDEX UX_WebHotelMiuIntakeBatch_YearWeekCustNo
    ON dbo.WebHotelMiuIntakeBatch (OrderYear, OrderWeek, CustKey, BatchNo)
    WHERE isDeleted = 0;
END;

IF OBJECT_ID(N'dbo.WebHotelMiuIntakeLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebHotelMiuIntakeLine (
    LineKey INT IDENTITY(1,1) PRIMARY KEY,
    BatchKey INT NOT NULL,
    RawName NVARCHAR(200) NOT NULL,
    Unit NVARCHAR(10) NOT NULL CONSTRAINT DF_WebHotelMiuIntakeLine_Unit DEFAULT N'',
    Qty FLOAT NOT NULL CONSTRAINT DF_WebHotelMiuIntakeLine_Qty DEFAULT 0,
    ProdKey INT NULL,
    ProdName NVARCHAR(200) NULL,
    SourceType NVARCHAR(10) NOT NULL CONSTRAINT DF_WebHotelMiuIntakeLine_Src DEFAULT N'text',
    SortOrder INT NOT NULL CONSTRAINT DF_WebHotelMiuIntakeLine_Ord DEFAULT 0
  );
END;

IF OBJECT_ID(N'dbo.WebHotelMiuProductMap', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebHotelMiuProductMap (
    MapKey INT IDENTITY(1,1) PRIMARY KEY,
    InputToken NVARCHAR(200) NOT NULL,
    ProdKey INT NOT NULL,
    ProdName NVARCHAR(200) NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Pn DEFAULT N'',
    DisplayName NVARCHAR(200) NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Dn DEFAULT N'',
    FlowerName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Fn DEFAULT N'',
    CounName NVARCHAR(60) NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Cn DEFAULT N'',
    Unit NVARCHAR(10) NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Un DEFAULT N'',
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_At DEFAULT GETDATE(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebHotelMiuProductMap_Del DEFAULT 0
  );
END;
