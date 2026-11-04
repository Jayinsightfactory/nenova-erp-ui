IF DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]approval[_]%'
 THROW 51000,'isolated approval fixture only',1;
GO
CREATE SCHEMA web_mgmt;
GO
CREATE TABLE web_mgmt.ApprovalRequest(RequestId int IDENTITY PRIMARY KEY,TargetKind nvarchar(40),TargetRef nvarchar(200),Version int,Status nvarchar(12),PayloadJson nvarchar(max),RequestedBy nvarchar(100),RequestedAt datetime2,DecidedBy nvarchar(100),DecidedAt datetime2,DecisionNote nvarchar(400),CreatedBy nvarchar(100),CreatedAt datetime2 DEFAULT SYSDATETIME(),UpdatedAt datetime2 DEFAULT SYSDATETIME());
CREATE TABLE web_mgmt.ApprovalAudit(AuditKey int IDENTITY PRIMARY KEY,RequestId int,FromStatus nvarchar(12),ToStatus nvarchar(12),ActorId nvarchar(100),Note nvarchar(400),CreatedAt datetime2 DEFAULT SYSDATETIME());
CREATE TABLE dbo.SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),SessionId nvarchar(200),ActionType nvarchar(50),Method nvarchar(10),Endpoint nvarchar(300),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(1000),RiskLevel nvarchar(20));
CREATE TABLE dbo.FreightCostDetail(WarehouseDetailKey int);
CREATE TABLE dbo.FreightCost(WarehouseKey int);
CREATE TABLE dbo.WebInvoiceOperation(WarehouseKey int,Status nvarchar(20));
CREATE TABLE dbo.WebInvoiceCostRevision(WarehouseKey int);
CREATE TABLE dbo.WebProfitReportConfirm(ConfirmKey int,OrderYear nvarchar(4),MajorWeek nvarchar(4),RevisionNo int,IsActive bit);
CREATE TABLE dbo.ShipmentFarm(SfarmKey int IDENTITY PRIMARY KEY,SdetailKey int,FarmKey int,ShipmentQuantity float);
CREATE TABLE dbo.ShipmentDate(SdateKey int IDENTITY PRIMARY KEY,SdetailKey int,ShipmentDtm datetime,ShipmentQuantity float,EstQuantity float,Cost float,Amount float,Vat float,Descr nvarchar(200));
CREATE TABLE dbo.ShipmentHistory(ShipHistoryKey int IDENTITY PRIMARY KEY,SdetailKey int,ChangeType nvarchar(50),ShipmentDtm datetime,BeforeValue nvarchar(100),AfterValue nvarchar(100),Descr nvarchar(500),ChangeID nvarchar(20),ChangeDtm datetime);
CREATE TABLE dbo.OrderHistory(OrderDetailKey int,ChangeType nvarchar(50),ColumName nvarchar(50),BeforeValue nvarchar(100),AfterValue nvarchar(100),Descr nvarchar(500),ChangeID nvarchar(20),ChangeDtm datetime);
CREATE TABLE dbo.PeriodDay(OrderYearWeek nvarchar(20),BaseYmd datetime);
CREATE TABLE dbo.Estimate(EstimateKey int,Amount float);
CREATE TABLE dbo.WebProfitReport(OrderYear nvarchar(4),MajorWeek nvarchar(4),Value float);
ALTER TABLE dbo.ShipmentDetail ADD CustKey int NULL,EstDescr nvarchar(200) NULL;
ALTER TABLE dbo.OrderDetail ADD CreateID nvarchar(20),CreateDtm datetime,LastUpdateID nvarchar(20),LastUpdateDtm datetime;
GO
CREATE VIEW dbo.ViewOrder AS SELECT om.OrderMasterKey,om.OrderYear,om.OrderWeek,om.CustKey,
om.OrderYear+REPLACE(om.OrderWeek,'-','') OrderYearWeek2,od.OrderDetailKey,od.ProdKey,od.OutQuantity
FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
JOIN UserInfo u ON u.UserID=om.Manager JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
JOIN Country ct ON ct.CounName=p.CounName JOIN Customer c ON c.CustKey=om.CustKey AND c.isDeleted=0 WHERE om.isDeleted=0;
GO
ALTER VIEW dbo.ViewShipment AS SELECT sm.ShipmentKey,sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,
 sm.OrderYear+REPLACE(sm.OrderWeek,'-','') OrderYearWeek2,sm.CustKey,sd.SdetailKey,
 sd.ProdKey,p.ProdName,p.CountryFlower,sd.OutQuantity,sd.isFix DetailFix
FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
JOIN Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0 WHERE sm.isDeleted=0;
GO
INSERT UserInfo(UserID,UserName) VALUES(N'fixture',N'fixture');
INSERT Country(CounName) VALUES(N'TEST');
INSERT Farm(FarmKey,FarmName) VALUES(1,N'Farm A'),(2,N'Farm B');
INSERT Product(ProdKey,ProdName,CountryFlower,CounName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock)
 VALUES(1,N'Flower A',N'TEST',N'TEST',N'단',N'단',10,10,100,100),(2,N'Flower B',N'TEST',N'TEST',N'단',N'단',10,10,100,100);
INSERT StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek) VALUES(1,N'2025',N'41-01',N'20254101'),(2,N'2026',N'41-01',N'20264101'),(3,N'2026',N'44-01',N'20264401'),(4,N'2027',N'01-01',N'20270101');
INSERT ProductStock(StockKey,ProdKey,Stock) VALUES(1,1,100),(1,2,100),(2,1,100),(2,2,100),(3,1,100),(3,2,100),(4,1,100),(4,2,100);
INSERT CodeInfo(Category,Descr) VALUES(N'StockType',N'재고조정');
INSERT WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,InputDate,isDeleted)
 VALUES(90,N'2026',N'41-01',N'Farm A',N'I-1',N'A-1','20261008',0),(89,N'2025',N'41-01',N'Farm A',N'OLD',N'OLD','20251008',0);
INSERT WarehouseDetail(WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
 VALUES(90,1,N'C',10,100,1000,100,100,110,11000,100,10),(89,1,N'OLD',1,99,990,99,99,1,99,990,10);
INSERT Customer(CustKey,CustName,Manager) VALUES(1,N'fixture',N'fixture');
INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager) VALUES(1,N'2026',N'41-01',N'202641',1,N'fixture'),(2,N'2025',N'41-01',N'202541',1,N'fixture');
INSERT OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,OutQuantity) VALUES(1,1,1,100),(2,2,2,999);
INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix) VALUES(1,N'2026',N'41-01',N'202641',1,1),(2,N'2025',N'41-01',N'202541',1,1);
INSERT ShipmentDetail(SdetailKey,ShipmentKey,ProdKey,OutQuantity,EstQuantity,Cost,Amount,Vat,isFix,ShipmentDtm)
 VALUES(1,1,1,100,100,110,10000,1000,1,'20261008'),(2,2,2,99,99,110,9900,990,1,'20251008');
INSERT ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat) VALUES(1,'20261008',60,60,110,6000,600),(1,'20261009',40,40,110,4000,400),(2,'20251008',99,99,110,9900,990);
INSERT PeriodDay VALUES(N'202641','20261008'),(N'202641','20261009');
INSERT Estimate VALUES(1,-500); INSERT WebProfitReport VALUES(N'2026',N'41',1000);
