-- Review and run separately by the main deployment owner. This file is not executed by the app.
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebEarlyShipmentOperation',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebEarlyShipmentOperation (
    OperationId uniqueidentifier NOT NULL PRIMARY KEY,
    RequestHash char(64) NOT NULL,
    Status nvarchar(16) NOT NULL,
    Revision int NOT NULL,
    SourceYear char(4) NOT NULL,
    SourceMajorWeek char(2) NOT NULL,
    TargetYear char(4) NOT NULL,
    TargetMajorWeek char(2) NOT NULL,
    CustKey int NOT NULL,
    ProdKey int NOT NULL,
    Unit nvarchar(16) NOT NULL,
    Quantity decimal(18,2) NOT NULL,
    SourceDate date NOT NULL,
    SourceOrderWeek varchar(5) NOT NULL,
    SourceStockAnchorWeek varchar(5) NOT NULL,
    TargetStockAnchorWeek varchar(5) NOT NULL,
    TargetImportWeek varchar(5) NOT NULL,
    AllocationIntent nvarchar(24) NOT NULL,
    SourceDateBefore decimal(18,3) NOT NULL,
    SourceDateFinal decimal(18,3) NOT NULL,
    SourceDateDelta decimal(18,3) NOT NULL,
    BeforeDigest char(64) NOT NULL,
    AllocationResponseJson nvarchar(max) NULL,
    ConfirmationAfterJson nvarchar(max) NULL,
    Actor nvarchar(128) NOT NULL,
    Reason nvarchar(1000) NOT NULL,
    ReversalOperationId uniqueidentifier NULL,
    ReversalRequestHash char(64) NULL,
    CreatedAt datetime2(3) NOT NULL,
    UpdatedAt datetime2(3) NOT NULL,
    CONSTRAINT CK_WebEarlyShipmentOperation_Status CHECK (Status IN (N'PENDING',N'APPLIED',N'REVERSED')),
    CONSTRAINT CK_WebEarlyShipmentOperation_Intent CHECK (AllocationIntent IN (N'MARK_EXISTING',N'APPLY_ABSOLUTE')),
    CONSTRAINT CK_WebEarlyShipmentOperation_Quantity CHECK (Quantity>0),
    CONSTRAINT CK_WebEarlyShipmentOperation_Revision CHECK (Revision>=0),
    CONSTRAINT CK_WebEarlyShipmentOperation_Response CHECK
      (AllocationResponseJson IS NULL OR ISJSON(AllocationResponseJson)=1),
    CONSTRAINT CK_WebEarlyShipmentOperation_Confirmation CHECK
      (ConfirmationAfterJson IS NULL OR ISJSON(ConfirmationAfterJson)=1)
  );
END;

IF OBJECT_ID(N'dbo.WebEarlyShipmentEffect',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebEarlyShipmentEffect (
    OperationId uniqueidentifier NOT NULL,
    EffectKind nvarchar(24) NOT NULL,
    StockHistoryKey int NOT NULL,
    OrderYear char(4) NOT NULL,
    OrderWeek varchar(5) NOT NULL,
    ProdKey int NOT NULL,
    Delta decimal(18,2) NOT NULL,
    BeforeStock decimal(18,2) NOT NULL,
    AfterStock decimal(18,2) NOT NULL,
    CONSTRAINT PK_WebEarlyShipmentEffect PRIMARY KEY (OperationId,EffectKind),
    CONSTRAINT FK_WebEarlyShipmentEffect_Operation FOREIGN KEY (OperationId)
      REFERENCES dbo.WebEarlyShipmentOperation(OperationId),
    CONSTRAINT FK_WebEarlyShipmentEffect_StockHistory FOREIGN KEY (StockHistoryKey)
      REFERENCES dbo.StockHistory(StockHistoryKey),
    CONSTRAINT CK_WebEarlyShipmentEffect_Kind CHECK
      (EffectKind IN (N'SOURCE',N'TARGET',N'REVERSE_SOURCE',N'REVERSE_TARGET')),
    CONSTRAINT CK_WebEarlyShipmentEffect_NonZero CHECK (Delta<>0)
  );
END;

IF OBJECT_ID(N'dbo.WebEarlyShipmentRevision',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebEarlyShipmentRevision (
    OperationId uniqueidentifier NOT NULL,
    Revision int NOT NULL,
    Action nvarchar(16) NOT NULL,
    Actor nvarchar(128) NOT NULL,
    Reason nvarchar(1000) NOT NULL,
    CreatedAt datetime2(3) NOT NULL,
    CONSTRAINT PK_WebEarlyShipmentRevision PRIMARY KEY (OperationId,Revision),
    CONSTRAINT FK_WebEarlyShipmentRevision_Operation FOREIGN KEY (OperationId)
      REFERENCES dbo.WebEarlyShipmentOperation(OperationId),
    CONSTRAINT CK_WebEarlyShipmentRevision_Action CHECK (Action IN (N'APPLY',N'REVERSE'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebEarlyShipmentOperation')
  AND name=N'IX_WebEarlyShipmentOperation_TargetActive')
  CREATE INDEX IX_WebEarlyShipmentOperation_TargetActive
    ON dbo.WebEarlyShipmentOperation(TargetYear,TargetMajorWeek,CustKey,ProdKey,Status)
    INCLUDE (Unit,Quantity,TargetImportWeek,Revision,OperationId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebEarlyShipmentOperation')
  AND name=N'IX_WebEarlyShipmentOperation_SourceDate')
  CREATE INDEX IX_WebEarlyShipmentOperation_SourceDate
    ON dbo.WebEarlyShipmentOperation(SourceYear,SourceMajorWeek,CustKey,ProdKey,Unit,SourceDate,Status)
    INCLUDE (Quantity,OperationId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebEarlyShipmentOperation')
  AND name=N'UX_WebEarlyShipmentOperation_Reversal')
  CREATE UNIQUE INDEX UX_WebEarlyShipmentOperation_Reversal
    ON dbo.WebEarlyShipmentOperation(ReversalOperationId)
    WHERE ReversalOperationId IS NOT NULL;

COMMIT TRANSACTION;

-- Rollback plan before production effects: drop Revision, Effect, then Operation.
-- After APPLIED effects exist, retain the ledger and reverse through the API; never drop audit rows.
