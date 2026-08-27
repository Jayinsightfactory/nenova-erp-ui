/*
  Isolated SQL Server 2016/compatibility-130 fixture for estimate directional edits.
  This file is intentionally self-contained: it has no ERP data, no linked server,
  no trigger, and no production procedure alteration. The harness creates a fresh
  database whose name is hard-guarded by scripts/test-estimate-directional-sql.cjs.

  Native reference: docs/migrations/backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql
  The harness installs that backup body unchanged as the reference calculator.
  Only the public procedure's owner-aware gate wrapper is fixture-owned.
*/

IF DB_NAME() NOT LIKE N'NenovaEstimateFixture[_]%'
  THROW 51000, 'fixture schema may only run in NenovaEstimateFixture_* databases', 1;
GO

CREATE TABLE dbo.UserInfo (
  UserID nvarchar(20) NOT NULL PRIMARY KEY,
  UserName nvarchar(100) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureUserDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.Customer (
  CustKey int NOT NULL PRIMARY KEY,
  CustName nvarchar(100) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureCustomerDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.Farm (
  FarmKey int NOT NULL PRIMARY KEY,
  FarmName nvarchar(100) NOT NULL,
  CounKey int NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureFarmDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.Product (
  ProdKey int NOT NULL PRIMARY KEY,
  ProdName nvarchar(200) NOT NULL,
  CountryFlower nvarchar(100) NULL,
  CounName nvarchar(100) NULL,
  FlowerName nvarchar(100) NULL,
  OutUnit nvarchar(20) NULL,
  EstUnit nvarchar(20) NULL,
  BunchOf1Box decimal(18,4) NULL,
  SteamOf1Bunch decimal(18,4) NULL,
  SteamOf1Box decimal(18,4) NULL,
  Cost decimal(18,4) NULL,
  Stock decimal(18,4) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureProductDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.OrderMaster (
  OrderMasterKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  CustKey int NOT NULL,
  Manager nvarchar(20) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureOrderMasterDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.OrderDetail (
  OrderDetailKey int NOT NULL PRIMARY KEY,
  OrderMasterKey int NOT NULL,
  CustKey int NOT NULL,
  ProdKey int NOT NULL,
  BoxQuantity decimal(18,4) NOT NULL CONSTRAINT DF_FixtureOrderDetailBox DEFAULT (0),
  BunchQuantity decimal(18,4) NOT NULL CONSTRAINT DF_FixtureOrderDetailBunch DEFAULT (0),
  SteamQuantity decimal(18,4) NOT NULL CONSTRAINT DF_FixtureOrderDetailSteam DEFAULT (0),
  OutQuantity decimal(18,4) NOT NULL CONSTRAINT DF_FixtureOrderDetailOut DEFAULT (0),
  OrderQuantity decimal(18,4) NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureOrderDetailDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.ShipmentMaster (
  ShipmentKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  CustKey int NOT NULL,
  isFix bit NOT NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureShipmentMasterDeleted DEFAULT (0),
  WebCreated bit NOT NULL CONSTRAINT DF_FixtureShipmentMasterWeb DEFAULT (1),
  CreateID nvarchar(20) NULL,
  CreateDtm datetime NOT NULL CONSTRAINT DF_FixtureShipmentMasterCreate DEFAULT (GETDATE())
);
GO

CREATE TABLE dbo.ShipmentDetail (
  SdetailKey int NOT NULL PRIMARY KEY,
  ShipmentKey int NOT NULL,
  CustKey int NOT NULL,
  ProdKey int NOT NULL,
  OutQuantity decimal(18,4) NOT NULL,
  EstQuantity decimal(18,4) NOT NULL,
  BoxQuantity decimal(18,4) NOT NULL,
  BunchQuantity decimal(18,4) NOT NULL,
  SteamQuantity decimal(18,4) NOT NULL,
  Cost decimal(18,4) NOT NULL,
  Amount decimal(18,4) NOT NULL,
  Vat decimal(18,4) NOT NULL,
  Descr nvarchar(1000) NULL,
  ShipmentDtm datetime NOT NULL,
  isFix bit NOT NULL
);
GO

CREATE TABLE dbo.ShipmentDate (
  SdateKey int NOT NULL PRIMARY KEY,
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

CREATE TABLE dbo.ShipmentFarm (
  FarmKey int NOT NULL,
  ShipmentQuantity decimal(18,4) NOT NULL,
  SdetailKey int NOT NULL,
  Descr nvarchar(1000) NULL,
  CONSTRAINT PK_FixtureShipmentFarm PRIMARY KEY (FarmKey, SdetailKey)
);
GO

CREATE TABLE dbo.ShipmentHistory (
  ShipmentHistoryKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  SdetailKey int NOT NULL,
  ShipmentDtm datetime NOT NULL,
  ChangeType nvarchar(50) NOT NULL,
  BeforeValue nvarchar(100) NULL,
  AfterValue nvarchar(100) NULL,
  Descr nvarchar(1000) NULL,
  ChangeID nvarchar(20) NULL,
  ChangeDtm datetime NOT NULL CONSTRAINT DF_FixtureShipmentHistoryDtm DEFAULT (GETDATE())
);
GO

CREATE TABLE dbo.Estimate (
  EstimateKey int NOT NULL PRIMARY KEY,
  ShipmentKey int NOT NULL,
  ProdKey int NULL,
  EstimateType nvarchar(100) NULL,
  Unit nvarchar(20) NULL,
  SdetailKey int NOT NULL,
  Quantity decimal(18,4) NOT NULL,
  Cost decimal(18,4) NOT NULL,
  Amount decimal(18,4) NOT NULL,
  Vat decimal(18,4) NOT NULL,
  isFix bit NOT NULL,
  Descr nvarchar(1000) NULL,
  EstimateDtm datetime NULL
);
GO

CREATE TABLE dbo.WarehouseMaster (
  WarehouseKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  UploadDtm datetime NOT NULL,
  FileName nvarchar(200) NULL,
  isDeleted bit NOT NULL CONSTRAINT DF_FixtureWarehouseMasterDeleted DEFAULT (0)
);
GO

CREATE TABLE dbo.WarehouseDetail (
  WdetailKey int NOT NULL PRIMARY KEY,
  WarehouseKey int NOT NULL,
  ProdKey int NOT NULL,
  FarmKey int NULL,
  BoxQuantity decimal(18,4) NOT NULL,
  BunchQuantity decimal(18,4) NOT NULL,
  SteamQuantity decimal(18,4) NOT NULL,
  OutQuantity decimal(18,4) NOT NULL,
  EstQuantity decimal(18,4) NOT NULL,
  UPrice decimal(18,4) NOT NULL,
  TPrice decimal(18,4) NOT NULL,
  SteamOf1Box decimal(18,4) NULL,
  SteamOf1Bunch decimal(18,4) NULL
);
GO

CREATE TABLE dbo.StockMaster (
  StockKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  OrderYearWeek nvarchar(20) NOT NULL,
  Descr nvarchar(1000) NULL,
  isFix tinyint NOT NULL CONSTRAINT DF_FixtureStockMasterFix DEFAULT (0),
  CreateID nvarchar(20) NULL,
  CreateDtm datetime NOT NULL CONSTRAINT DF_FixtureStockMasterCreate DEFAULT (GETDATE()),
  LastUpdateID nvarchar(20) NULL,
  LastUpdateDtm datetime NULL
);
GO

CREATE TABLE dbo.ProductStock (
  StockKey int NOT NULL,
  ProdKey int NOT NULL,
  Stock decimal(18,4) NOT NULL,
  CONSTRAINT PK_FixtureProductStock PRIMARY KEY (StockKey, ProdKey)
);
GO

CREATE TABLE dbo.StockHistory (
  StockHistoryKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  ChangeDtm datetime NOT NULL,
  OrderYear nvarchar(20) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  ChangeID nvarchar(20) NULL,
  ChangeType nvarchar(50) NOT NULL,
  ColumName nvarchar(100) NULL,
  BeforeValue decimal(18,4) NOT NULL,
  AfterValue decimal(18,4) NOT NULL,
  Descr nvarchar(1000) NULL,
  ProdKey int NOT NULL
);
GO

CREATE TABLE dbo.CodeInfo (
  Category nvarchar(100) NOT NULL,
  Descr nvarchar(100) NOT NULL,
  CONSTRAINT PK_FixtureCodeInfo PRIMARY KEY (Category, Descr)
);
GO

/* Explicit fixture seam for native-calc failure injection. */
CREATE TABLE dbo.FixtureNativeCalcControl (
  ControlKey tinyint NOT NULL PRIMARY KEY,
  FailNext bit NOT NULL,
  NullNext bit NOT NULL CONSTRAINT DF_FixtureNativeCalcNullNext DEFAULT (0),
  FailureMessage nvarchar(200) NOT NULL
);
GO

/* Owner-aware gate: a failed CALC must not clear another owner's lease. */
CREATE TABLE dbo.NenovaStockWeekGate (
  GateKey char(1) NOT NULL PRIMARY KEY,
  Mode nvarchar(20) NULL,
  LockedAt datetime NULL,
  Action nvarchar(20) NULL,
  OrderYear nvarchar(20) NULL,
  OrderWeek nvarchar(20) NULL,
  OwnerSessionID int NULL,
  OwnerToken uniqueidentifier NULL,
  PendingCalc bit NOT NULL CONSTRAINT DF_FixtureGatePending DEFAULT (0),
  CalcProdKey int NULL,
  ProtocolVersion smallint NOT NULL CONSTRAINT DF_FixtureGateProtocol DEFAULT (2)
);
GO

CREATE TABLE dbo.FixtureAudit (
  AuditKey int NOT NULL PRIMARY KEY,
  ActionName nvarchar(100) NOT NULL,
  OwnerToken nvarchar(100) NULL,
  Detail nvarchar(1000) NULL,
  CreatedAt datetime NOT NULL CONSTRAINT DF_FixtureAuditCreated DEFAULT (GETDATE())
);
GO

CREATE TABLE dbo.AppLog (
  LogKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  Category nvarchar(100) NULL,
  Step nvarchar(100) NULL,
  Detail nvarchar(1000) NULL,
  IsError bit NOT NULL CONSTRAINT DF_FixtureAppLogError DEFAULT (0),
  CreatedAt datetime NOT NULL CONSTRAINT DF_FixtureAppLogCreated DEFAULT (GETDATE())
);
GO

CREATE TABLE dbo.SystemActionLog (
  LogKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  ActionDtm datetime NOT NULL CONSTRAINT DF_FixtureSystemActionDtm DEFAULT (GETDATE()),
  Actor nvarchar(100) NULL,
  SessionId nvarchar(200) NULL,
  ActionType nvarchar(50) NULL,
  Method nvarchar(10) NULL,
  Endpoint nvarchar(300) NULL,
  AffectedTable nvarchar(100) NULL,
  AffectedCount int NOT NULL CONSTRAINT DF_FixtureSystemActionCount DEFAULT (0),
  Payload nvarchar(max) NULL,
  Result nvarchar(20) NULL,
  ResultDesc nvarchar(1000) NULL,
  RiskLevel nvarchar(20) NULL,
  IpAddress nvarchar(50) NULL,
  UserAgent nvarchar(500) NULL
);
GO

CREATE TABLE dbo.WebErpEditLease (
  OrderYear nvarchar(4) NOT NULL,
  OrderWeek nvarchar(16) NOT NULL,
  CustKey int NOT NULL,
  LeaseToken nvarchar(64) NOT NULL,
  OwnerUserId nvarchar(100) NOT NULL,
  OwnerName nvarchar(200) NOT NULL,
  ClientId nvarchar(128) NOT NULL,
  PageCode nvarchar(80) NOT NULL,
  BaselineDigest char(64) NOT NULL,
  Revision int NOT NULL CONSTRAINT DF_FixtureLeaseRevision DEFAULT (0),
  AcquiredAt datetime2(3) NOT NULL CONSTRAINT DF_FixtureLeaseAcquired DEFAULT (SYSUTCDATETIME()),
  HeartbeatAt datetime2(3) NOT NULL CONSTRAINT DF_FixtureLeaseHeartbeat DEFAULT (SYSUTCDATETIME()),
  ExpiresAt datetime2(3) NOT NULL,
  CONSTRAINT PK_FixtureWebErpEditLease PRIMARY KEY (OrderYear,OrderWeek,CustKey)
);
GO

IF OBJECT_ID(N'dbo.ViewShipment', N'V') IS NOT NULL DROP VIEW dbo.ViewShipment;
GO
CREATE VIEW dbo.ViewShipment AS
SELECT
  sm.ShipmentKey,
  sm.OrderYear,
  sm.OrderWeek,
  SUBSTRING(sm.OrderWeek, 0, 3) AS OrderWeek2,
  sm.OrderYearWeek,
  sm.CustKey,
  sd.ProdKey,
  p.ProdName,
  p.CountryFlower,
  sd.OutQuantity,
  sd.EstQuantity,
  sd.BoxQuantity,
  sd.BunchQuantity,
  sd.SteamQuantity,
  sd.ShipmentDtm,
  sd.Cost,
  sd.Amount,
  sd.Vat,
  sd.Descr,
  sd.isFix AS DetailFix,
  sd.SdetailKey
FROM dbo.ShipmentMaster sm
JOIN dbo.ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
JOIN dbo.Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
JOIN dbo.Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
WHERE sm.isDeleted = 0;
GO

IF OBJECT_ID(N'dbo.ViewWarehouse', N'V') IS NOT NULL DROP VIEW dbo.ViewWarehouse;
GO
CREATE VIEW dbo.ViewWarehouse AS
SELECT
  wm.WarehouseKey,
  wm.UploadDtm,
  wm.FileName,
  wm.OrderYear,
  wm.OrderWeek,
  SUBSTRING(wm.OrderWeek, 0, 3) AS OrderWeek2,
  wd.WdetailKey,
  wd.ProdKey,
  wd.FarmKey,
  wd.BoxQuantity,
  wd.BunchQuantity,
  wd.SteamQuantity,
  wd.OutQuantity,
  wd.EstQuantity,
  wd.UPrice,
  wd.TPrice,
  wd.SteamOf1Box,
  wd.SteamOf1Bunch
FROM dbo.WarehouseMaster wm
JOIN dbo.WarehouseDetail wd ON wm.WarehouseKey = wd.WarehouseKey
WHERE wm.isDeleted = 0;
GO

IF OBJECT_ID(N'dbo.usp_NenovaStockWeekGateEnter', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateEnter;
GO
CREATE PROCEDURE dbo.usp_NenovaStockWeekGateEnter
  @Action nvarchar(20),
  @OrderYear nvarchar(20),
  @OrderWeek nvarchar(20),
  @oResult int OUTPUT,
  @oMessage nvarchar(200) OUTPUT,
  @ProtocolVersion int = NULL,
  @OwnerToken uniqueidentifier = NULL OUTPUT,
  @CalcProdKey int = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET @OwnerToken = NULL;
  SET @oResult = -99;
  SET @oMessage = N'fixture gate busy or pending calculation';
  IF ISNULL(@ProtocolVersion,0) <> 2
  BEGIN
    SET @oResult = -98;
    SET @oMessage = N'fixture gate protocol v2 required';
    RETURN;
  END
  IF @Action IS NULL OR @Action NOT IN (N'FIX',N'CANCEL',N'CALC')
     OR @Action=N'CALC' AND (ISNULL(@CalcProdKey,-1) < 0)
  BEGIN
    SET @oResult = -98;
    SET @oMessage = N'fixture gate scope invalid';
    RETURN;
  END
  DECLARE @newToken uniqueidentifier = NEWID();
  UPDATE dbo.NenovaStockWeekGate WITH (UPDLOCK, ROWLOCK, NOWAIT)
     SET Mode = N'RUN', OwnerSessionID = @@SPID, OwnerToken = @newToken,
         LockedAt = GETDATE(), Action = @Action, OrderYear = @OrderYear,
         OrderWeek = @OrderWeek, CalcProdKey = @CalcProdKey
   WHERE GateKey = '1' AND ProtocolVersion=2
     AND ((Mode IS NULL AND PendingCalc=0 AND OwnerSessionID IS NULL AND OwnerToken IS NULL)
       OR (Mode=N'WAIT_CALC' AND PendingCalc=1 AND @Action=N'CALC' AND @CalcProdKey=0
           AND OrderYear=@OrderYear AND OrderWeek=@OrderWeek));
  IF @@ROWCOUNT = 1
  BEGIN
    SET @OwnerToken = @newToken;
    SET @oResult = 0;
    SET @oMessage = N'';
  END
END;
GO

IF OBJECT_ID(N'dbo.usp_NenovaStockWeekGateCapability', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateCapability;
GO
CREATE PROCEDURE dbo.usp_NenovaStockWeekGateCapability
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CAST(ProtocolVersion AS int) AS ProtocolVersion,
         CAST(CASE WHEN ProtocolVersion=2 THEN 1 ELSE 0 END AS int) AS IsReady
    FROM dbo.NenovaStockWeekGate
   WHERE GateKey='1';
END;
GO

IF OBJECT_ID(N'dbo.usp_NenovaStockWeekGateLeave', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateLeave;
GO
CREATE PROCEDURE dbo.usp_NenovaStockWeekGateLeave
  @Action nvarchar(20),
  @Success bit,
  @ProtocolVersion int = NULL,
  @OwnerToken uniqueidentifier = NULL,
  @oResult int = NULL OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @oResult = -98;
  IF ISNULL(@ProtocolVersion,0) <> 2 OR @OwnerToken IS NULL OR @Success IS NULL
     OR @Action IS NULL OR @Action NOT IN (N'FIX',N'CANCEL',N'CALC') RETURN;
  DECLARE @pending bit = CASE WHEN (@Action IN (N'FIX',N'CANCEL') AND @Success=1)
                                  OR (@Action=N'CALC' AND @Success=0) THEN 1 ELSE 0 END;
  UPDATE dbo.NenovaStockWeekGate
     SET Mode=CASE WHEN @pending=1 THEN N'WAIT_CALC' ELSE NULL END,
         LockedAt=CASE WHEN @pending=1 THEN GETDATE() ELSE NULL END,
         Action=CASE WHEN @pending=1 THEN @Action ELSE NULL END,
         OrderYear=CASE WHEN @pending=1 THEN OrderYear ELSE NULL END,
         OrderWeek=CASE WHEN @pending=1 THEN OrderWeek ELSE NULL END,
         OwnerSessionID=CASE WHEN @pending=1 THEN OwnerSessionID ELSE NULL END,
         OwnerToken=CASE WHEN @pending=1 THEN OwnerToken ELSE NULL END,
         PendingCalc=@pending, CalcProdKey=NULL
   WHERE GateKey='1' AND ProtocolVersion=2 AND Mode=N'RUN' AND Action=@Action
     AND OwnerSessionID=@@SPID AND OwnerToken=@OwnerToken;
  IF @@ROWCOUNT=1 SET @oResult=0;
END;
GO

IF OBJECT_ID(N'dbo.usp_NenovaStockWeekGateClear', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateClear;
GO
CREATE PROCEDURE dbo.usp_NenovaStockWeekGateClear
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51061, 'fixture unsafe gate clear disabled', 1;
END;
GO

/*
The exact native body is installed by the harness from
docs/migrations/backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql
under dbo.usp_StockCalculation_Reference. Keep the fixture's public procedure
as a gate-only wrapper so the calculator itself cannot silently become a
fixture reimplementation.
IF OBJECT_ID(N'dbo.usp_StockCalculation', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation;
*/
GO
/*
CREATE PROCEDURE dbo.usp_StockCalculation
  @OrderYear nvarchar(20),
  @OrderWeek nvarchar(20),
  @ProdKey int,
  @iUserID nvarchar(20),
  @oResult int OUTPUT,
  @oMessage nvarchar(MAX) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @oResult = 0;
  SET @oMessage = N'';
  DECLARE @owner uniqueidentifier;
  DECLARE @calcKey int = ISNULL(@ProdKey,0);
  DECLARE @gateResult int, @gateMessage nvarchar(200);
  EXEC dbo.usp_NenovaStockWeekGateEnter
       @Action=N'CALC', @OrderYear=@OrderYear, @OrderWeek=@OrderWeek,
       @oResult=@gateResult OUTPUT, @oMessage=@gateMessage OUTPUT,
       @ProtocolVersion=2, @OwnerToken=@owner OUTPUT, @CalcProdKey=@calcKey;
  IF @gateResult <> 0
  BEGIN
    SET @oResult = @gateResult;
    SET @oMessage = @gateMessage;
    RETURN @gateResult;
  END

  BEGIN TRY
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM dbo.FixtureNativeCalcControl WHERE ControlKey=1 AND FailNext=1)
    BEGIN
      UPDATE dbo.FixtureNativeCalcControl SET FailNext=0 WHERE ControlKey=1;
      THROW 51001, 'fixture forced native calculation failure', 1;
    END

    DECLARE @startYwk nvarchar(20) = @OrderYear + REPLACE(@OrderWeek, N'-', N'');
    IF NOT EXISTS (SELECT 1 FROM dbo.StockMaster WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek)
    BEGIN
      INSERT dbo.StockMaster (StockKey, OrderYear, OrderWeek, OrderYearWeek, Descr, CreateID, LastUpdateID)
      SELECT ISNULL(MAX(StockKey),0)+1, @OrderYear, @OrderWeek, @startYwk, N'', @iUserID, @iUserID
      FROM dbo.StockMaster;
    END

    DECLARE @stockKey int, @beforeStockKey int;
    DECLARE stock_cursor CURSOR LOCAL FAST_FORWARD FOR
      SELECT StockKey, OrderYear, OrderWeek
      FROM dbo.StockMaster
      WHERE OrderYearWeek >= @startYwk
      ORDER BY OrderYearWeek, StockKey;
    DECLARE @calcYear nvarchar(20), @calcWeek nvarchar(20);
    OPEN stock_cursor;
    FETCH NEXT FROM stock_cursor INTO @stockKey, @calcYear, @calcWeek;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      SELECT TOP (1) @beforeStockKey=StockKey
        FROM dbo.StockMaster
       WHERE OrderYearWeek < (@calcYear + REPLACE(@calcWeek,N'-',N''))
       ORDER BY OrderYearWeek DESC, StockKey DESC;

      ;WITH ProductList AS (
        SELECT p.ProdKey,
               ISNULL(prev.Stock,0) AS PrevStock
          FROM dbo.Product p
          LEFT JOIN dbo.ProductStock prev ON prev.StockKey=@beforeStockKey AND prev.ProdKey=p.ProdKey
         WHERE p.isDeleted=0 AND (ISNULL(@ProdKey,0)=0 OR p.ProdKey=@ProdKey)
      ), WarehouseList AS (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) AS InQty
          FROM dbo.ViewWarehouse
         WHERE OrderYear=@calcYear AND OrderWeek=@calcWeek
         GROUP BY ProdKey
      ), ShipmentList AS (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) AS OutQty
          FROM dbo.ViewShipment
         WHERE OrderYear=@calcYear AND OrderWeek=@calcWeek AND DetailFix=1
         GROUP BY ProdKey
      ), AdjustmentList AS (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) AS AdjQty
          FROM dbo.StockHistory sh
          JOIN dbo.CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
         WHERE sh.OrderYear=@calcYear AND sh.OrderWeek=@calcWeek
         GROUP BY sh.ProdKey
      )
      UPDATE ps
         SET Stock=ROUND(pl.PrevStock+ISNULL(w.InQty,0)-ISNULL(s.OutQty,0)+ISNULL(a.AdjQty,0),2)
        FROM dbo.ProductStock ps
        JOIN ProductList pl ON pl.ProdKey=ps.ProdKey
        LEFT JOIN WarehouseList w ON w.ProdKey=pl.ProdKey
        LEFT JOIN ShipmentList s ON s.ProdKey=pl.ProdKey
        LEFT JOIN AdjustmentList a ON a.ProdKey=pl.ProdKey
       WHERE ps.StockKey=@stockKey;

      ;WITH ProductList AS (
        SELECT p.ProdKey, ISNULL(prev.Stock,0) AS PrevStock
          FROM dbo.Product p
          LEFT JOIN dbo.ProductStock prev ON prev.StockKey=@beforeStockKey AND prev.ProdKey=p.ProdKey
         WHERE p.isDeleted=0 AND (ISNULL(@ProdKey,0)=0 OR p.ProdKey=@ProdKey)
      ), WarehouseList AS (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) AS InQty FROM dbo.ViewWarehouse
         WHERE OrderYear=@calcYear AND OrderWeek=@calcWeek GROUP BY ProdKey
      ), ShipmentList AS (
        SELECT ProdKey, ROUND(SUM(OutQuantity),2) AS OutQty FROM dbo.ViewShipment
         WHERE OrderYear=@calcYear AND OrderWeek=@calcWeek AND DetailFix=1 GROUP BY ProdKey
      ), AdjustmentList AS (
        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) AS AdjQty
          FROM dbo.StockHistory sh JOIN dbo.CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType
         WHERE sh.OrderYear=@calcYear AND sh.OrderWeek=@calcWeek GROUP BY sh.ProdKey
      )
      INSERT dbo.ProductStock (StockKey, ProdKey, Stock)
      SELECT @stockKey, pl.ProdKey,
             ROUND(pl.PrevStock+ISNULL(w.InQty,0)-ISNULL(s.OutQty,0)+ISNULL(a.AdjQty,0),2)
        FROM ProductList pl
        LEFT JOIN WarehouseList w ON w.ProdKey=pl.ProdKey
        LEFT JOIN ShipmentList s ON s.ProdKey=pl.ProdKey
        LEFT JOIN AdjustmentList a ON a.ProdKey=pl.ProdKey
       WHERE NOT EXISTS (SELECT 1 FROM dbo.ProductStock ps WHERE ps.StockKey=@stockKey AND ps.ProdKey=pl.ProdKey);

      SET @beforeStockKey=NULL;
      FETCH NEXT FROM stock_cursor INTO @stockKey, @calcYear, @calcWeek;
    END
    CLOSE stock_cursor;
    DEALLOCATE stock_cursor;
    COMMIT TRANSACTION;
    EXEC dbo.usp_NenovaStockWeekGateLeave
         @Action=N'CALC', @Success=1, @ProtocolVersion=2,
         @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
    IF @gateResult <> 0 THROW 51002, 'fixture CALC gate release failed', 1;
    SET @oMessage=N'fixture calculation complete';
    RETURN 0;
  END TRY
  BEGIN CATCH
    IF CURSOR_STATUS('local','stock_cursor') >= 0 CLOSE stock_cursor;
    IF CURSOR_STATUS('local','stock_cursor') >= -1 DEALLOCATE stock_cursor;
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    EXEC dbo.usp_NenovaStockWeekGateLeave
         @Action=N'CALC', @Success=0, @ProtocolVersion=2,
         @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
    SET @oResult=-1;
    SET @oMessage=ERROR_MESSAGE();
    RETURN -1;
  END CATCH
END;
*/
GO

CREATE PROCEDURE dbo.usp_StockCalculation
  @OrderYear nvarchar(20),
  @OrderWeek nvarchar(20),
  @ProdKey int,
  @iUserID nvarchar(20),
  @oResult int OUTPUT,
  @oMessage nvarchar(MAX) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @oResult = -1;
  SET @oMessage = N'fixture native calculation failed';
  DECLARE @owner uniqueidentifier;
  DECLARE @gateResult int;
  DECLARE @gateMessage nvarchar(200);
  DECLARE @calcKey int = ISNULL(@ProdKey,0);

  EXEC dbo.usp_NenovaStockWeekGateEnter
       @Action=N'CALC', @OrderYear=@OrderYear, @OrderWeek=@OrderWeek,
       @oResult=@gateResult OUTPUT, @oMessage=@gateMessage OUTPUT,
       @ProtocolVersion=2, @OwnerToken=@owner OUTPUT, @CalcProdKey=@calcKey;
  IF @gateResult <> 0
  BEGIN
    SET @oResult = @gateResult;
    SET @oMessage = @gateMessage;
    RETURN @gateResult;
  END

  BEGIN TRY
    IF EXISTS (SELECT 1 FROM dbo.FixtureNativeCalcControl WHERE ControlKey=1 AND FailNext=1)
    BEGIN
      UPDATE dbo.FixtureNativeCalcControl SET FailNext=0 WHERE ControlKey=1;
      THROW 51001, 'fixture forced native calculation failure', 1;
    END
    IF EXISTS (SELECT 1 FROM dbo.FixtureNativeCalcControl WHERE ControlKey=1 AND NullNext=1)
    BEGIN
      UPDATE dbo.FixtureNativeCalcControl SET NullNext=0 WHERE ControlKey=1;
      SET @oResult = NULL;
      SET @oMessage = NULL;
      EXEC dbo.usp_NenovaStockWeekGateLeave
           @Action=N'CALC', @Success=1, @ProtocolVersion=2,
           @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
      RETURN 0;
    END
    DECLARE @nativeReturn int;
    EXEC @nativeReturn = dbo.usp_StockCalculation_Reference
      @OrderYear=@OrderYear, @OrderWeek=@OrderWeek, @ProdKey=@ProdKey,
      @iUserID=@iUserID, @oResult=@oResult OUTPUT, @oMessage=@oMessage OUTPUT;
    IF @nativeReturn = 0 AND @oResult = 0
    BEGIN
      EXEC dbo.usp_NenovaStockWeekGateLeave
           @Action=N'CALC', @Success=1, @ProtocolVersion=2,
           @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
      IF @gateResult <> 0
      BEGIN
        SET @oResult = -1;
        SET @oMessage = N'fixture CALC gate release failed';
        RETURN -1;
      END
    END
    ELSE
    BEGIN
      EXEC dbo.usp_NenovaStockWeekGateLeave
           @Action=N'CALC', @Success=0, @ProtocolVersion=2,
           @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
    END
    RETURN @nativeReturn;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    EXEC dbo.usp_NenovaStockWeekGateLeave
         @Action=N'CALC', @Success=0, @ProtocolVersion=2,
         @OwnerToken=@owner, @oResult=@gateResult OUTPUT;
    SET @oResult = -1;
    SET @oMessage = ERROR_MESSAGE();
    RETURN -1;
  END CATCH
END;
GO

INSERT dbo.UserInfo (UserID, UserName) VALUES (N'admin',N'관리자');
INSERT dbo.Customer (CustKey, CustName) VALUES (1,N'Fixture Customer'),(2,N'Fixture Other Customer');
INSERT dbo.Farm (FarmKey, FarmName) VALUES (1,N'Fixture Farm');
INSERT dbo.CodeInfo (Category, Descr) VALUES (N'StockType',N'재고조정');
INSERT dbo.FixtureNativeCalcControl (ControlKey, FailNext, FailureMessage)
  VALUES (1,0,N'fixture forced native calculation failure');
INSERT dbo.NenovaStockWeekGate (GateKey, Mode) VALUES ('1',NULL);
GO
