/*
  Isolated invoice-receipt writer fixture base schema.
  ERP columns are the minimum exact fields consumed by the captured native SQL.
  The harness uses Korean_Wansung_CI_AS because usp_CreateWarehouse contains
  unprefixed Korean varchar unit literals ('박스'/'단'); preserve that native
  comparison context without editing the captured procedure.
  Product.Stock and warehouse quantities intentionally use SQL Server float;
  dbo.WarehouseDetail.WdetailKey is IDENTITY, matching the live evidence.
  Six WebInvoice tables are installed separately by the guarded harness migration.
*/
IF DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]%'
  THROW 51000, 'invoice receipt schema may only run in NenovaInvoiceFixture_* databases', 1;
IF (SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME()) <> 130
  THROW 51001, 'invoice receipt schema requires compatibility level 130', 1;
GO

CREATE TABLE dbo.UserInfo (
  UserID nvarchar(20) NOT NULL PRIMARY KEY,
  UserName nvarchar(100) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureUserDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.Country (
  CounName nvarchar(100) NOT NULL PRIMARY KEY,
  isUseOrderCode bit NOT NULL CONSTRAINT DF_InvoiceFixtureCountryOrderCode DEFAULT(0)
);
GO
CREATE TABLE dbo.Customer (
  CustKey int NOT NULL PRIMARY KEY,
  CustName nvarchar(200) NOT NULL,
  CustArea nvarchar(100) NULL,
  Manager nvarchar(20) NULL,
  Descr nvarchar(1000) NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureCustomerDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.Farm (
  FarmKey int NOT NULL PRIMARY KEY,
  FarmName nvarchar(200) NOT NULL,
  CounKey int NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureFarmDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.Product (
  ProdKey int NOT NULL PRIMARY KEY,
  ProdName nvarchar(250) NOT NULL,
  CountryFlower nvarchar(100) NULL,
  CounName nvarchar(100) NULL,
  FlowerName nvarchar(100) NULL,
  OutUnit nvarchar(20) NULL,
  EstUnit nvarchar(20) NULL,
  BunchOf1Box float NULL,
  SteamOf1Bunch float NULL,
  SteamOf1Box float NULL,
  Cost float NULL,
  Stock float NULL,
  isDeleted bit NULL CONSTRAINT DF_InvoiceFixtureProductDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.OrderMaster (
  OrderMasterKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  OrderDtm datetime NULL,
  CustKey int NOT NULL,
  Manager nvarchar(20) NOT NULL,
  OrderCode nvarchar(100) NULL,
  Descr nvarchar(500) NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureOrderMasterDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.OrderDetail (
  OrderDetailKey int NOT NULL PRIMARY KEY,
  OrderMasterKey int NOT NULL,
  ProdKey int NOT NULL,
  Descr nvarchar(1000) NULL,
  BoxQuantity float NULL,
  BunchQuantity float NULL,
  SteamQuantity float NULL,
  OutQuantity float NULL,
  EstQuantity float NULL,
  NoneOutQuantity float NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureOrderDetailDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.ShipmentMaster (
  ShipmentKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  CustKey int NOT NULL,
  isFix bit NOT NULL CONSTRAINT DF_InvoiceFixtureShipmentFix DEFAULT(0),
  isDeleted bit NOT NULL CONSTRAINT DF_InvoiceFixtureShipmentDeleted DEFAULT(0)
);
GO
CREATE TABLE dbo.ShipmentDetail (
  SdetailKey int NOT NULL PRIMARY KEY,
  ShipmentKey int NOT NULL,
  ProdKey int NOT NULL,
  BoxQuantity float NULL,
  BunchQuantity float NULL,
  SteamQuantity float NULL,
  OutQuantity float NOT NULL,
  EstQuantity float NULL,
  Cost float NULL,
  Amount float NULL,
  Vat float NULL,
  Descr nvarchar(1000) NULL,
  ShipmentDtm datetime NULL,
  isFix bit NOT NULL CONSTRAINT DF_InvoiceFixtureShipmentDetailFix DEFAULT(0)
);
GO
CREATE TABLE dbo.StockMaster (
  StockKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  Descr nvarchar(1000) NULL,
  isFix tinyint NOT NULL CONSTRAINT DF_InvoiceFixtureStockFix DEFAULT(0),
  CreateID nvarchar(20) NULL,
  CreateDtm datetime NOT NULL CONSTRAINT DF_InvoiceFixtureStockCreated DEFAULT(GETDATE()),
  LastUpdateID nvarchar(20) NULL,
  LastUpdateDtm datetime NULL
);
GO
CREATE TABLE dbo.ProductStock (
  StockKey int NOT NULL,
  ProdKey int NOT NULL,
  Stock float NOT NULL,
  CONSTRAINT PK_InvoiceFixtureProductStock PRIMARY KEY(StockKey,ProdKey)
);
GO
CREATE TABLE dbo.CodeInfo (
  Category nvarchar(100) NOT NULL,
  Descr nvarchar(100) NOT NULL,
  CONSTRAINT PK_InvoiceFixtureCodeInfo PRIMARY KEY(Category,Descr)
);
GO
CREATE TABLE dbo.StockHistory (
  StockHistoryKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  ChangeDtm datetime NOT NULL,
  OrderYear nvarchar(20) NULL,
  OrderWeek nvarchar(20) NULL,
  ChangeID nvarchar(20) NULL,
  ChangeType nvarchar(50) NULL,
  ColumName nvarchar(100) NULL,
  BeforeValue float NULL,
  AfterValue float NULL,
  Descr nvarchar(500) NULL,
  ProdKey int NULL
);
GO

/* Exact live column order matters: native usp_GetNextKey uses positional INSERT. */
CREATE TABLE dbo.KeyNumbering (
  Category nvarchar(30) NOT NULL PRIMARY KEY,
  LastKeyNo int NOT NULL,
  Descr nvarchar(100) NOT NULL
);
GO
CREATE TABLE dbo.WarehouseMaster (
  WarehouseKey int NOT NULL PRIMARY KEY,
  UploadDtm datetime NULL,
  FileName nvarchar(500) NULL,
  OrderYear nvarchar(4) NULL,
  OrderWeek nvarchar(20) NULL,
  FarmName nvarchar(100) NULL,
  InvoiceNo nvarchar(50) NULL,
  InputDate datetime NULL,
  OrderNo nvarchar(50) NULL,
  isDeleted bit NULL,
  CreateID nvarchar(50) NULL,
  CreateDtm datetime NULL,
  LastUpdateID nvarchar(50) NULL,
  LastUpdateDtm datetime NULL,
  GrossWeight decimal(10,2) NULL,
  ChargeableWeight decimal(10,2) NULL,
  FreightRateUSD decimal(10,4) NULL,
  DocFeeUSD decimal(10,2) NULL
);
GO
CREATE TABLE dbo.WarehouseDetail (
  WdetailKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  ProdKey int NULL,
  OrderCode nvarchar(20) NULL,
  BoxQuantity float NULL,
  BunchQuantity float NULL,
  SteamQuantity float NULL,
  OutQuantity float NULL,
  EstQuantity float NULL,
  UPrice float NULL,
  TPrice float NULL,
  WarehouseKey int NOT NULL,
  SteamOf1Box float NULL,
  SteamOf1Bunch float NULL
);
GO
CREATE TABLE dbo.TempWarehouseDetail (
  WdetailKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  ProdKey int NULL,
  ProdName nvarchar(250) NULL,
  BoxQuantity float NULL,
  BunchQuantity float NULL,
  SteamQuantity float NULL,
  OutQuantity float NULL,
  EstQuantity float NULL,
  UPrice float NULL,
  TPrice float NULL,
  Stock float NULL,
  OrderCode nvarchar(20) NULL,
  WarehouseKey int NOT NULL,
  SteamOf1Box float NULL,
  SteamOf1Bunch float NULL
);
GO

CREATE TABLE dbo.NenovaStockWeekGate (
  GateKey char(1) NOT NULL PRIMARY KEY,
  Mode nvarchar(20) NULL,
  LockedAt datetime NULL,
  Action nvarchar(20) NULL,
  OrderYear nvarchar(20) NULL,
  OrderWeek nvarchar(20) NULL,
  OwnerSessionID int NULL,
  OwnerToken uniqueidentifier NULL,
  PendingCalc bit NOT NULL CONSTRAINT DF_InvoiceFixtureGatePending DEFAULT(0),
  CalcProdKey int NULL,
  ProtocolVersion smallint NOT NULL CONSTRAINT DF_InvoiceFixtureGateVersion DEFAULT(2)
);
GO
INSERT dbo.NenovaStockWeekGate(GateKey,PendingCalc,ProtocolVersion) VALUES('1',0,2);
GO
CREATE PROCEDURE dbo.usp_NenovaStockWeekGateCapability
AS
BEGIN
  SET NOCOUNT ON;
  SELECT 2 AS ProtocolVersion,CAST(1 AS int) AS IsReady;
END;
GO

/* Failure injection is fixture-only; it trips inside native stock recalculation. */
CREATE TABLE dbo.FixtureNativeCalcControl (
  ControlKey tinyint NOT NULL PRIMARY KEY,
  FailNext bit NOT NULL
);
GO
INSERT dbo.FixtureNativeCalcControl(ControlKey,FailNext) VALUES(1,0);
GO
CREATE TRIGGER dbo.trg_InvoiceFixture_FailStockCalc
ON dbo.ProductStock AFTER INSERT,UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS(SELECT 1 FROM dbo.FixtureNativeCalcControl WHERE ControlKey=1 AND FailNext=1)
    THROW 51090,'fixture injected stock calculation failure',1;
END;
GO

CREATE VIEW dbo.ViewWarehouse
AS
SELECT wm.WarehouseKey,wm.UploadDtm,wm.FileName,wm.OrderYear,wm.OrderWeek,
  SUBSTRING(wm.OrderWeek,0,3) AS OrderWeek2,
  wm.OrderYear+REPLACE(wm.OrderWeek,'-','') AS OrderYearWeek2,
  wm.FarmName,f.CounKey,wm.InvoiceNo,wm.InputDate,wd.OrderCode,wd.WdetailKey,
  wd.ProdKey,p.ProdName,p.FlowerName,p.CounName,p.CountryFlower,
  wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.EstQuantity,
  wd.UPrice,wd.TPrice,wd.SteamOf1Box,wd.SteamOf1Bunch
FROM dbo.WarehouseMaster wm
JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
LEFT JOIN dbo.Farm f ON f.FarmName=wm.FarmName AND f.isDeleted=0
WHERE ISNULL(wm.isDeleted,0)=0;
GO
CREATE VIEW dbo.ViewShipment
AS
SELECT sm.ShipmentKey,sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,
  sm.OrderYear+REPLACE(sm.OrderWeek,'-','') AS OrderYearWeek2,sm.CustKey,
  sd.ProdKey,p.ProdName,p.CountryFlower,sd.OutQuantity,sd.isFix AS DetailFix
FROM dbo.ShipmentMaster sm
JOIN dbo.ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
JOIN dbo.Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
JOIN dbo.Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0
WHERE sm.isDeleted=0;
GO
