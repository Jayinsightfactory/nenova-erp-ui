/*
  Additive schema for the estimate-next-subweek-overflow SQL harness.
  The harness first loads estimateDirectionalSchema.sql, then this file.
  It must never be applied to an operational Nenova database.
*/
IF DB_NAME() NOT LIKE N'NenovaEstimateFixture[_]%'
  THROW 51000, 'overflow fixture schema may only run in NenovaEstimateFixture_* databases', 1;
GO

IF OBJECT_ID(N'dbo.ViewOrder', N'V') IS NOT NULL DROP VIEW dbo.ViewOrder;
IF OBJECT_ID(N'dbo.ViewShipment', N'V') IS NOT NULL DROP VIEW dbo.ViewShipment;
GO

-- Native ClassShipmentDate.Insert relies on the ERP identity key.
DROP TABLE dbo.ShipmentDate;
GO
CREATE TABLE dbo.ShipmentDate (
  SdateKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  SdetailKey int NOT NULL,
  ShipmentDtm datetime NOT NULL,
  ShipmentQuantity decimal(18,4) NOT NULL,
  EstQuantity decimal(18,4) NOT NULL,
  Cost decimal(18,4) NOT NULL,
  Amount decimal(18,4) NOT NULL,
  Vat decimal(18,4) NOT NULL,
  Descr nvarchar(1000) NULL
);
GO

ALTER TABLE dbo.Customer ADD BaseOutDay int NULL, Manager nvarchar(20) NULL, OrderCode nvarchar(50) NULL;
GO
ALTER TABLE dbo.OrderMaster ADD OrderDtm datetime NULL, OrderCode nvarchar(50) NULL, Descr nvarchar(1000) NULL,
  CreateID nvarchar(20) NULL, CreateDtm datetime NULL, LastUpdateID nvarchar(20) NULL, LastUpdateDtm datetime NULL;
GO
ALTER TABLE dbo.OrderDetail ADD EstQuantity decimal(18,4) NULL, NoneOutQuantity decimal(18,4) NULL,
  Descr nvarchar(1000) NULL, CreateID nvarchar(20) NULL, CreateDtm datetime NULL, LastUpdateID nvarchar(20) NULL, LastUpdateDtm datetime NULL;
GO
-- These two columns are nullable only because the historical fixture DDL is
-- broader than the native INSERT; production constraints are not changed.
ALTER TABLE dbo.OrderDetail ALTER COLUMN CustKey int NULL;
ALTER TABLE dbo.OrderDetail ALTER COLUMN OrderQuantity decimal(18,4) NULL;
GO
ALTER TABLE dbo.ShipmentDetail ADD EstDescr nvarchar(1000) NULL;
GO
ALTER TABLE dbo.ShipmentDetail ADD EstQuantity2 decimal(18,4) NULL;
ALTER TABLE dbo.ShipmentMaster ADD EstimateName nvarchar(200) NULL, LastUpdateID nvarchar(20) NULL, LastUpdateDtm datetime NULL;
CREATE TABLE dbo.CustomerProdCost (AutoKey int IDENTITY PRIMARY KEY, CustKey int NOT NULL, ProdKey int NOT NULL, Cost decimal(18,4) NOT NULL, Descr nvarchar(1000) NULL);
CREATE TABLE dbo.WeekProdCost (AutoKey int IDENTITY PRIMARY KEY, OrderYear nvarchar(4) NULL, OrderWeek nvarchar(20) NOT NULL, CustKey int NOT NULL, ProdKey int NOT NULL, Cost decimal(18,4) NOT NULL, UpdatedAt datetime NULL, UpdatedBy nvarchar(20) NULL);
GO

CREATE TABLE dbo.Country (
  CounName nvarchar(100) NOT NULL PRIMARY KEY
);
GO

CREATE TABLE dbo.PeriodDay (
  OrderYearWeek nvarchar(20) NOT NULL,
  WeekDay int NOT NULL,
  BaseYmd datetime NOT NULL,
  CONSTRAINT PK_FixturePeriodDay PRIMARY KEY (OrderYearWeek, WeekDay)
);
GO

CREATE TABLE dbo.KeyNumbering (
  Category nvarchar(100) NOT NULL PRIMARY KEY,
  LastKeyNo int NOT NULL,
  Descr nvarchar(1000) NULL
);
GO

CREATE TABLE dbo.OrderHistory (
  OrderHistoryKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  OrderDetailKey int NOT NULL,
  ChangeType nvarchar(50) NOT NULL,
  ColumName nvarchar(100) NULL,
  BeforeValue nvarchar(100) NULL,
  AfterValue nvarchar(100) NULL,
  Descr nvarchar(1000) NULL,
  ChangeID nvarchar(20) NULL,
  ChangeDtm datetime NOT NULL CONSTRAINT DF_FixtureOrderHistoryDtm DEFAULT (GETDATE())
);
GO

CREATE VIEW dbo.ViewShipment AS
SELECT sm.ShipmentKey, sm.OrderYear, sm.OrderWeek,
       sm.OrderYearWeek AS OrderYearWeek,
       sm.OrderYear + REPLACE(sm.OrderWeek,N'-',N'') AS OrderYearWeek2,
       SUBSTRING(sm.OrderWeek,0,3) AS OrderWeek2,
       sm.CustKey, sd.ProdKey, p.ProdName, p.CountryFlower,
       sd.OutQuantity, sd.EstQuantity, sd.BoxQuantity, sd.BunchQuantity,
       sd.SteamQuantity, sd.ShipmentDtm, sd.Cost, sd.Amount, sd.Vat,
       sd.Descr, sd.isFix AS DetailFix, sd.SdetailKey
  FROM dbo.ShipmentMaster sm
  JOIN dbo.ShipmentDetail sd ON sm.ShipmentKey=sd.ShipmentKey
  JOIN dbo.Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
  JOIN dbo.Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0
 WHERE sm.isDeleted=0;
GO

IF OBJECT_ID(N'dbo.ViewOrder', N'V') IS NOT NULL DROP VIEW dbo.ViewOrder;
GO
CREATE VIEW dbo.ViewOrder AS
SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek,
       om.OrderYearWeek AS OrderYearWeek,
       om.OrderYear + REPLACE(om.OrderWeek,N'-',N'') AS OrderYearWeek2,
       om.CustKey, od.OrderDetailKey, od.ProdKey, od.OutQuantity,
       p.ProdName, p.CountryFlower
  FROM dbo.OrderMaster om
  JOIN dbo.OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
  JOIN dbo.Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
  JOIN dbo.Customer c ON c.CustKey=om.CustKey AND c.isDeleted=0
  JOIN dbo.UserInfo u ON u.UserID=om.Manager AND u.isDeleted=0
  JOIN dbo.Country co ON co.CounName=p.CounName
 WHERE om.isDeleted=0 AND od.isDeleted=0;
GO

UPDATE dbo.Customer SET BaseOutDay=4, Manager=N'admin', OrderCode=N'FIX' WHERE CustKey=1;
INSERT dbo.Country (CounName) VALUES (N'Fixture Country');
GO
