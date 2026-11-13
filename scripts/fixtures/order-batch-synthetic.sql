-- Disposable NenovaUploadSynthetic ONLY. Structures cover the API's executed
-- columns; ViewOrder below is the documented native definition, not an API mock.
CREATE TABLE OrderBatchFixtureGuard(Id int PRIMARY KEY, Marker nvarchar(100));
INSERT OrderBatchFixtureGuard VALUES(1,N'nenova-order-batch-synthetic-v1');
CREATE TABLE Customer(CustKey int PRIMARY KEY,CustName nvarchar(100),CustArea nvarchar(100),Manager nvarchar(60),OrderCode nvarchar(100),Descr nvarchar(max),isDeleted bit NOT NULL);
CREATE TABLE Country(CounName nvarchar(100) PRIMARY KEY,isUseOrderCode bit);
CREATE TABLE Product(ProdKey int PRIMARY KEY,ProdName nvarchar(100),FlowerName nvarchar(100),OutUnit nvarchar(20),EstUnit nvarchar(20),CounName nvarchar(100),CountryFlower nvarchar(100),Descr nvarchar(max),BunchOf1Box float,SteamOf1Box float,SteamOf1Bunch float,isDeleted bit NOT NULL);
CREATE TABLE OrderMaster(OrderMasterKey int PRIMARY KEY,OrderDtm datetime,OrderYear nvarchar(4),OrderWeek nvarchar(10),OrderYearWeek nvarchar(20),Manager nvarchar(60),CustKey int,OrderCode nvarchar(100),Descr nvarchar(max),isDeleted bit NOT NULL,CreateID nvarchar(60),CreateDtm datetime,LastUpdateID nvarchar(60),LastUpdateDtm datetime);
CREATE INDEX IX_OrderMaster_Scope ON OrderMaster(CustKey,OrderYear,OrderWeek);
CREATE TABLE OrderDetail(OrderDetailKey int PRIMARY KEY,OrderMasterKey int,ProdKey int,BoxQuantity float,BunchQuantity float,SteamQuantity float,OutQuantity float,EstQuantity float,NoneOutQuantity float,Descr nvarchar(max),isDeleted bit NOT NULL,CreateID nvarchar(60),CreateDtm datetime,LastUpdateID nvarchar(60),LastUpdateDtm datetime);
CREATE INDEX IX_OrderDetail_MasterProduct ON OrderDetail(OrderMasterKey,ProdKey);
CREATE TABLE ShipmentMaster(ShipmentKey int PRIMARY KEY,CustKey int,OrderYear nvarchar(4),OrderWeek nvarchar(10),OrderYearWeek nvarchar(20),isFix bit,isDeleted bit,EstimateName nvarchar(100),WebCreated bit,CreateID nvarchar(60),CreateDtm datetime);
CREATE INDEX IX_ShipmentMaster_Scope ON ShipmentMaster(CustKey,OrderYear,OrderWeek);
CREATE TABLE ShipmentDetail(ShipmentDetailKey int PRIMARY KEY,ShipmentKey int,CustKey int,ProdKey int,OutQuantity float,isDeleted bit);
CREATE TABLE ShipmentDate(Id int PRIMARY KEY,Sentinel nvarchar(50));
CREATE TABLE ShipmentFarm(Id int PRIMARY KEY,Sentinel nvarchar(50));
CREATE TABLE Estimate(Id int PRIMARY KEY,Sentinel nvarchar(50));
CREATE TABLE WebProfitReport(Id int PRIMARY KEY,Sentinel nvarchar(50));
CREATE TABLE ProductStock(Id int PRIMARY KEY,Sentinel nvarchar(50));
CREATE TABLE OrderHistory(OrderHistoryKey int IDENTITY PRIMARY KEY,OrderDetailKey int,ChangeType nvarchar(100),ColumName nvarchar(100),BeforeValue nvarchar(100),AfterValue nvarchar(100),Descr nvarchar(max),ChangeID nvarchar(60),ChangeDtm datetime);
CREATE TABLE KeyNumbering(Category nvarchar(100) PRIMARY KEY,LastKeyNo int,Descr nvarchar(max));
CREATE TABLE AppLog(Id int IDENTITY PRIMARY KEY,Category nvarchar(100),Step nvarchar(100),Detail nvarchar(max),IsError bit,LogDtm datetime DEFAULT GETDATE());
GO
CREATE VIEW dbo.ViewOrder AS
SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek,
       SUBSTRING(om.OrderWeek,0,3) AS OrderWeek2,
       om.OrderYear + SUBSTRING(om.OrderWeek,0,3) AS OrderYearWeek,
       om.OrderYear + REPLACE(om.OrderWeek,'-','') AS OrderYearWeek2,
       om.OrderDtm, ui.UserName AS Manager,
       om.CustKey, c.CustName, c.CustArea, c.Manager AS BusinessManager,
       c.Descr AS CustDescr, ct.isUseOrderCode, om.OrderCode, om.Descr,
       od.OrderDetailKey, od.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
       od.Descr AS DetailDescr, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
       od.OutQuantity, od.EstQuantity, od.NoneOutQuantity
FROM OrderMaster om
JOIN OrderDetail od ON om.OrderMasterKey=od.OrderMasterKey
JOIN Customer c ON om.CustKey=c.CustKey AND c.isDeleted=0
JOIN Product p ON od.ProdKey=p.ProdKey AND p.isDeleted=0
JOIN Country ct ON p.CounName=ct.CounName
JOIN UserInfo ui ON om.Manager=ui.UserID
WHERE om.isDeleted=0 AND od.isDeleted=0;
