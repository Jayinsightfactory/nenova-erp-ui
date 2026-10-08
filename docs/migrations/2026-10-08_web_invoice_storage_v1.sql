-- Web-only invoice document, receipt-operation, history, and cost snapshot storage V1.
-- SQL Server 2016 compatible. This migration creates no ERP FK, executes no ERP SP,
-- and never reads or writes Warehouse*, TempWarehouseDetail, stock, order, or shipment data.
--
-- Allowed databases:
--   * production: nenova1_nenova
--   * isolated fixtures: NenovaInvoiceFixture_*
--
-- Re-running is a no-op only when all six tables still match the V1 structural contract.
-- A partial installation or structural drift fails without attempting repair.

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 10000;

DECLARE @DatabaseName sysname = DB_NAME();

IF @DatabaseName <> N'nenova1_nenova'
   AND @DatabaseName NOT LIKE N'NenovaInvoiceFixture[_]%'
BEGIN
  ;THROW 51000, 'WEB_INVOICE_V1_DATABASE_NOT_ALLOWED', 1;
END;

IF @@TRANCOUNT <> 0
BEGIN
  ;THROW 51001, 'WEB_INVOICE_V1_EXTERNAL_TRANSACTION_NOT_ALLOWED', 1;
END;

DECLARE @ExpectedTables TABLE (
  TableName sysname NOT NULL PRIMARY KEY
);

INSERT INTO @ExpectedTables (TableName)
VALUES
  (N'WebInvoiceDocument'),
  (N'WebInvoiceLine'),
  (N'WebInvoiceOperation'),
  (N'WebInvoiceHistory'),
  (N'WebInvoiceCostRevision'),
  (N'WebInvoiceCostLine');

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @AppLockResult int;

  EXEC @AppLockResult = sys.sp_getapplock
    @Resource = N'NenovaWeb:WebInvoiceStorage:V1:Migration',
    @LockMode = N'Exclusive',
    @LockOwner = N'Transaction',
    @LockTimeout = 10000,
    @DbPrincipal = N'public';

  IF @AppLockResult < 0
  BEGIN
    ;THROW 51002, 'WEB_INVOICE_V1_APPLOCK_FAILED', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM @ExpectedTables AS expected
    JOIN sys.objects AS existing
      ON existing.schema_id = SCHEMA_ID(N'dbo')
     AND existing.name = expected.TableName
    WHERE existing.[type] <> N'U'
  )
  BEGIN
    ;THROW 51003, 'WEB_INVOICE_V1_NAME_OCCUPIED_BY_NON_TABLE', 1;
  END;

  DECLARE @ExistingTableCount int = (
    SELECT COUNT(*)
    FROM @ExpectedTables AS expected
    JOIN sys.tables AS existing
      ON existing.schema_id = SCHEMA_ID(N'dbo')
     AND existing.name = expected.TableName
  );
  DECLARE @CreatedNow bit = 0;

  IF @ExistingTableCount NOT IN (0, 6)
  BEGIN
    ;THROW 51004, 'WEB_INVOICE_V1_PARTIAL_SCHEMA_EXISTS', 1;
  END;

  IF @ExistingTableCount = 0
  BEGIN
    SET @CreatedNow = 1;

    DECLARE @CreateSql nvarchar(max) = N'
    CREATE TABLE dbo.WebInvoiceDocument (
      DocumentId            uniqueidentifier NOT NULL,
      OrderYear             char(4) NOT NULL,
      OrderWeek             char(5) NOT NULL,
      Revision              int NOT NULL,
      FarmKey               int NULL,
      InvoiceNo             nvarchar(100) NULL,
      InvoiceYear           char(4) NULL,
      SourceHash            binary(32) NOT NULL,
      OriginalFileName      nvarchar(520) NOT NULL,
      BusinessKeyHash       binary(32) NULL,
      ReceiptStatus         nvarchar(20) NOT NULL,
      CostStatus            nvarchar(20) NOT NULL,
      RawMetadataJson       nvarchar(max) NULL,
      ReviewedMetadataJson  nvarchar(max) NULL,
      CreatedBy             nvarchar(200) NOT NULL,
      CreatedAt             datetime2(3) NOT NULL,
      UpdatedBy             nvarchar(200) NOT NULL,
      UpdatedAt             datetime2(3) NOT NULL,
      RowVersion            rowversion NOT NULL,

      CONSTRAINT PK_WebInvoiceDocument
        PRIMARY KEY CLUSTERED (DocumentId),
      CONSTRAINT CK_WebInvoiceDocument_OrderScope CHECK (
        LEN(OrderYear) = 4
        AND OrderYear COLLATE Latin1_General_100_BIN2 NOT LIKE ''%[^0-9]%''
        AND LEN(OrderWeek) = 5
        AND OrderWeek COLLATE Latin1_General_100_BIN2 LIKE ''[0-9][0-9]-[0-9][0-9]''
        AND TRY_CONVERT(int, LEFT(OrderWeek, 2)) BETWEEN 1 AND 53
        AND TRY_CONVERT(int, RIGHT(OrderWeek, 2)) BETWEEN 1 AND 99
      ),
      CONSTRAINT CK_WebInvoiceDocument_Revision CHECK (Revision > 0),
      CONSTRAINT CK_WebInvoiceDocument_FarmKey CHECK (FarmKey IS NULL OR FarmKey > 0),
      CONSTRAINT CK_WebInvoiceDocument_InvoiceYear CHECK (
        InvoiceYear IS NULL
        OR (
          LEN(InvoiceYear) = 4
          AND InvoiceYear COLLATE Latin1_General_100_BIN2 NOT LIKE ''%[^0-9]%''
        )
      ),
      CONSTRAINT CK_WebInvoiceDocument_ReceiptStatus CHECK (
        ReceiptStatus = N''DRAFT''
        OR ReceiptStatus = N''REVIEW_REQUIRED''
        OR ReceiptStatus = N''PARTIAL''
        OR ReceiptStatus = N''COMMITTED''
      ),
      CONSTRAINT CK_WebInvoiceDocument_CostStatus CHECK (
        CostStatus = N''PENDING''
        OR CostStatus = N''REVIEW_REQUIRED''
        OR CostStatus = N''APPROVED''
        OR CostStatus = N''STALE''
      ),
      CONSTRAINT CK_WebInvoiceDocument_RequiredText CHECK (
        LEN(LTRIM(RTRIM(OriginalFileName))) > 0
        AND LEN(LTRIM(RTRIM(CreatedBy))) > 0
        AND LEN(LTRIM(RTRIM(UpdatedBy))) > 0
      ),
      CONSTRAINT CK_WebInvoiceDocument_MetadataJson CHECK (
        (RawMetadataJson IS NULL OR ISJSON(RawMetadataJson) = 1)
        AND (ReviewedMetadataJson IS NULL OR ISJSON(ReviewedMetadataJson) = 1)
      ),
      CONSTRAINT CK_WebInvoiceDocument_Times CHECK (UpdatedAt >= CreatedAt)
    );

    CREATE UNIQUE INDEX UX_WebInvoiceDocument_BusinessKeyHash
      ON dbo.WebInvoiceDocument (BusinessKeyHash)
      WHERE BusinessKeyHash IS NOT NULL;

    CREATE INDEX IX_WebInvoiceDocument_OrderScope
      ON dbo.WebInvoiceDocument (OrderYear, OrderWeek, ReceiptStatus, DocumentId);

    CREATE TABLE dbo.WebInvoiceLine (
      DocumentId         uniqueidentifier NOT NULL,
      Revision           int NOT NULL,
      LineId             uniqueidentifier NOT NULL,
      [LineNo]           int NOT NULL,
      OriginalName       nvarchar(500) NOT NULL,
      LengthText         nvarchar(100) NULL,
      ProdKey            int NULL,
      BoxQuantity        decimal(18,6) NULL,
      BunchQuantity      decimal(18,6) NULL,
      StemQuantity       decimal(18,6) NULL,
      PriceUnit          nvarchar(40) NULL,
      UnitPrice          decimal(18,6) NULL,
      Currency           char(3) NULL,
      LineAmount         decimal(18,6) NULL,
      SourceEvidenceJson nvarchar(max) NULL,
      ReviewedJson       nvarchar(max) NULL,

      CONSTRAINT PK_WebInvoiceLine
        PRIMARY KEY CLUSTERED (DocumentId, Revision, LineId),
      CONSTRAINT FK_WebInvoiceLine_Document
        FOREIGN KEY (DocumentId)
        REFERENCES dbo.WebInvoiceDocument (DocumentId),
      CONSTRAINT CK_WebInvoiceLine_RevisionLineNo CHECK (Revision > 0 AND [LineNo] > 0),
      CONSTRAINT CK_WebInvoiceLine_RequiredText CHECK (LEN(LTRIM(RTRIM(OriginalName))) > 0),
      CONSTRAINT CK_WebInvoiceLine_ProdKey CHECK (ProdKey IS NULL OR ProdKey > 0),
      CONSTRAINT CK_WebInvoiceLine_Quantities CHECK (
        (BoxQuantity IS NULL OR BoxQuantity >= 0)
        AND (BunchQuantity IS NULL OR BunchQuantity >= 0)
        AND (StemQuantity IS NULL OR StemQuantity >= 0)
      ),
      CONSTRAINT CK_WebInvoiceLine_Currency CHECK (
        Currency IS NULL
        OR (
          LEN(Currency) = 3
          AND Currency COLLATE Latin1_General_100_BIN2 NOT LIKE ''%[^A-Z]%''
        )
      ),
      CONSTRAINT CK_WebInvoiceLine_Json CHECK (
        (SourceEvidenceJson IS NULL OR ISJSON(SourceEvidenceJson) = 1)
        AND (ReviewedJson IS NULL OR ISJSON(ReviewedJson) = 1)
      )
    );

    CREATE UNIQUE INDEX UX_WebInvoiceLine_LineNo
      ON dbo.WebInvoiceLine (DocumentId, Revision, [LineNo]);

    CREATE INDEX IX_WebInvoiceLine_ProdKey
      ON dbo.WebInvoiceLine (ProdKey, DocumentId, Revision);

    CREATE TABLE dbo.WebInvoiceOperation (
      OperationId       uniqueidentifier NOT NULL,
      DocumentId        uniqueidentifier NOT NULL,
      DocumentRevision  int NOT NULL,
      ReceiptPartId     uniqueidentifier NOT NULL,
      RequestHash       binary(32) NOT NULL,
      Action            nvarchar(20) NOT NULL,
      Status            nvarchar(20) NOT NULL,
      WarehouseKey      int NULL,
      ResultJson        nvarchar(max) NULL,
      ErrorCode         nvarchar(100) NULL,
      Actor             nvarchar(200) NOT NULL,
      CreatedAt         datetime2(3) NOT NULL,
      CompletedAt       datetime2(3) NULL,

      CONSTRAINT PK_WebInvoiceOperation
        PRIMARY KEY CLUSTERED (OperationId),
      CONSTRAINT FK_WebInvoiceOperation_Document
        FOREIGN KEY (DocumentId)
        REFERENCES dbo.WebInvoiceDocument (DocumentId),
      CONSTRAINT CK_WebInvoiceOperation_DocumentRevision CHECK (DocumentRevision > 0),
      CONSTRAINT CK_WebInvoiceOperation_Action CHECK (
        Action = N''CREATE_RECEIPT'' OR Action = N''UPDATE_RECEIPT''
      ),
      CONSTRAINT CK_WebInvoiceOperation_Status CHECK (
        Status = N''PENDING''
        OR Status = N''COMMITTED''
        OR Status = N''FAILED''
        OR Status = N''UNKNOWN''
      ),
      CONSTRAINT CK_WebInvoiceOperation_WarehouseKey CHECK (
        WarehouseKey IS NULL OR WarehouseKey > 0
      ),
      CONSTRAINT CK_WebInvoiceOperation_CommitState CHECK (
        Status <> N''COMMITTED''
        OR (WarehouseKey IS NOT NULL AND CompletedAt IS NOT NULL)
      ),
      CONSTRAINT CK_WebInvoiceOperation_Actor CHECK (LEN(LTRIM(RTRIM(Actor))) > 0),
      CONSTRAINT CK_WebInvoiceOperation_ResultJson CHECK (
        ResultJson IS NULL OR ISJSON(ResultJson) = 1
      ),
      CONSTRAINT CK_WebInvoiceOperation_Times CHECK (
        CompletedAt IS NULL OR CompletedAt >= CreatedAt
      )
    );

    CREATE UNIQUE INDEX UX_WebInvoiceOperation_DocumentRevisionOperation
      ON dbo.WebInvoiceOperation (DocumentId, DocumentRevision, OperationId);

    CREATE UNIQUE INDEX UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse
      ON dbo.WebInvoiceOperation (DocumentId, DocumentRevision, OperationId, WarehouseKey);

    CREATE INDEX IX_WebInvoiceOperation_DocumentStatus
      ON dbo.WebInvoiceOperation (DocumentId, Status, CreatedAt, OperationId);

    CREATE TABLE dbo.WebInvoiceHistory (
      HistoryId   bigint IDENTITY(1,1) NOT NULL,
      DocumentId  uniqueidentifier NOT NULL,
      Revision    int NOT NULL,
      OperationId uniqueidentifier NULL,
      Action      nvarchar(60) NOT NULL,
      BeforeJson  nvarchar(max) NULL,
      AfterJson   nvarchar(max) NULL,
      Reason      nvarchar(1000) NULL,
      Actor       nvarchar(200) NOT NULL,
      CreatedAt   datetime2(3) NOT NULL,

      CONSTRAINT PK_WebInvoiceHistory
        PRIMARY KEY CLUSTERED (HistoryId),
      CONSTRAINT FK_WebInvoiceHistory_Document
        FOREIGN KEY (DocumentId)
        REFERENCES dbo.WebInvoiceDocument (DocumentId),
      CONSTRAINT FK_WebInvoiceHistory_OperationScope
        FOREIGN KEY (DocumentId, Revision, OperationId)
        REFERENCES dbo.WebInvoiceOperation (DocumentId, DocumentRevision, OperationId),
      CONSTRAINT CK_WebInvoiceHistory_Revision CHECK (Revision > 0),
      CONSTRAINT CK_WebInvoiceHistory_RequiredText CHECK (
        LEN(LTRIM(RTRIM(Action))) > 0
        AND LEN(LTRIM(RTRIM(Actor))) > 0
      ),
      CONSTRAINT CK_WebInvoiceHistory_Json CHECK (
        (BeforeJson IS NULL OR ISJSON(BeforeJson) = 1)
        AND (AfterJson IS NULL OR ISJSON(AfterJson) = 1)
      )
    );

    CREATE INDEX IX_WebInvoiceHistory_DocumentRevision
      ON dbo.WebInvoiceHistory (DocumentId, Revision, CreatedAt, HistoryId);

    CREATE TABLE dbo.WebInvoiceCostRevision (
      CostRevisionId    uniqueidentifier NOT NULL,
      DocumentId        uniqueidentifier NOT NULL,
      DocumentRevision  int NOT NULL,
      OperationId       uniqueidentifier NOT NULL,
      WarehouseKey      int NOT NULL,
      RevisionNo        int NOT NULL,
      Basis             nvarchar(20) NOT NULL,
      Status            nvarchar(20) NOT NULL,
      Currency          char(3) NOT NULL,
      FormulaId         nvarchar(100) NOT NULL,
      FormulaVersion    nvarchar(50) NOT NULL,
      FormulaSourceHash binary(32) NOT NULL,
      InputSnapshotJson nvarchar(max) NOT NULL,
      ApprovedBy        nvarchar(200) NULL,
      ApprovedAt        datetime2(3) NULL,
      CreatedBy         nvarchar(200) NOT NULL,
      CreatedAt         datetime2(3) NOT NULL,

      CONSTRAINT PK_WebInvoiceCostRevision
        PRIMARY KEY CLUSTERED (CostRevisionId),
      CONSTRAINT FK_WebInvoiceCostRevision_OperationScope
        FOREIGN KEY (DocumentId, DocumentRevision, OperationId, WarehouseKey)
        REFERENCES dbo.WebInvoiceOperation
          (DocumentId, DocumentRevision, OperationId, WarehouseKey),
      CONSTRAINT CK_WebInvoiceCostRevision_Keys CHECK (
        DocumentRevision > 0 AND WarehouseKey > 0 AND RevisionNo > 0
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_Basis CHECK (
        Basis = N''ACTUAL'' OR Basis = N''EXPECTED_95''
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_Status CHECK (
        Status = N''DRAFT'' OR Status = N''APPROVED'' OR Status = N''STALE''
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_Currency CHECK (
        LEN(Currency) = 3
        AND Currency COLLATE Latin1_General_100_BIN2 NOT LIKE ''%[^A-Z]%''
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_RequiredText CHECK (
        LEN(LTRIM(RTRIM(FormulaId))) > 0
        AND LEN(LTRIM(RTRIM(FormulaVersion))) > 0
        AND LEN(LTRIM(RTRIM(CreatedBy))) > 0
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_InputSnapshotJson CHECK (
        ISJSON(InputSnapshotJson) = 1
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_Approval CHECK (
        (ApprovedBy IS NULL AND ApprovedAt IS NULL)
        OR (
          ApprovedBy IS NOT NULL
          AND LEN(LTRIM(RTRIM(ApprovedBy))) > 0
          AND ApprovedAt IS NOT NULL
          AND ApprovedAt >= CreatedAt
        )
      ),
      CONSTRAINT CK_WebInvoiceCostRevision_ApprovedState CHECK (
        Status <> N''APPROVED''
        OR (ApprovedBy IS NOT NULL AND ApprovedAt IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX UX_WebInvoiceCostRevision_OperationBasisRevision
      ON dbo.WebInvoiceCostRevision (DocumentId, OperationId, Basis, RevisionNo);

    CREATE UNIQUE INDEX UX_WebInvoiceCostRevision_LineScope
      ON dbo.WebInvoiceCostRevision
        (CostRevisionId, DocumentId, DocumentRevision, OperationId, WarehouseKey);

    CREATE INDEX IX_WebInvoiceCostRevision_Warehouse
      ON dbo.WebInvoiceCostRevision (WarehouseKey, Status, CreatedAt, CostRevisionId);

    CREATE TABLE dbo.WebInvoiceCostLine (
      CostRevisionId     uniqueidentifier NOT NULL,
      LineId             uniqueidentifier NOT NULL,
      DocumentId         uniqueidentifier NOT NULL,
      DocumentRevision   int NOT NULL,
      OperationId        uniqueidentifier NOT NULL,
      WarehouseKey       int NOT NULL,
      WdetailKey         int NOT NULL,
      ProdKey            int NOT NULL,
      Unit               nvarchar(40) NOT NULL,
      Quantity           decimal(18,6) NOT NULL,
      CostPerUnit        decimal(18,6) NULL,
      TotalCost          decimal(18,6) NULL,
      ComponentAmountsJson nvarchar(max) NULL,

      CONSTRAINT PK_WebInvoiceCostLine
        PRIMARY KEY CLUSTERED (CostRevisionId, LineId),
      CONSTRAINT FK_WebInvoiceCostLine_CostRevisionScope
        FOREIGN KEY
          (CostRevisionId, DocumentId, DocumentRevision, OperationId, WarehouseKey)
        REFERENCES dbo.WebInvoiceCostRevision
          (CostRevisionId, DocumentId, DocumentRevision, OperationId, WarehouseKey),
      CONSTRAINT FK_WebInvoiceCostLine_SourceLine
        FOREIGN KEY (DocumentId, DocumentRevision, LineId)
        REFERENCES dbo.WebInvoiceLine (DocumentId, Revision, LineId),
      CONSTRAINT CK_WebInvoiceCostLine_Keys CHECK (
        DocumentRevision > 0
        AND WarehouseKey > 0
        AND WdetailKey > 0
        AND ProdKey > 0
      ),
      CONSTRAINT CK_WebInvoiceCostLine_Unit CHECK (LEN(LTRIM(RTRIM(Unit))) > 0),
      CONSTRAINT CK_WebInvoiceCostLine_Amounts CHECK (
        Quantity >= 0
        AND (CostPerUnit IS NULL OR CostPerUnit >= 0)
        AND (TotalCost IS NULL OR TotalCost >= 0)
      ),
      CONSTRAINT CK_WebInvoiceCostLine_ComponentAmountsJson CHECK (
        ComponentAmountsJson IS NULL OR ISJSON(ComponentAmountsJson) = 1
      )
    );

    CREATE INDEX IX_WebInvoiceCostLine_WarehouseDetail
      ON dbo.WebInvoiceCostLine (WarehouseKey, WdetailKey, ProdKey, CostRevisionId);
';

    EXEC sys.sp_executesql @CreateSql;
  END;

  -----------------------------------------------------------------------------
  -- Exact V1 structural verification. This runs after creation and on every
  -- re-run. It checks all columns, identity/rowversion properties, named CHECKs,
  -- PK/index definitions, FK column mappings/actions, and absence of defaults,
  -- triggers, or extra structural objects on the six tables.
  -----------------------------------------------------------------------------

  DECLARE @ExpectedColumns TABLE (
    TableName    sysname NOT NULL,
    ColumnId     int NOT NULL,
    ColumnName   sysname NOT NULL,
    SystemTypeId tinyint NOT NULL,
    MaxLength    smallint NOT NULL,
    [Precision]  tinyint NOT NULL,
    Scale        tinyint NOT NULL,
    IsNullable   bit NOT NULL,
    IsIdentity   bit NOT NULL,
    PRIMARY KEY (TableName, ColumnId)
  );

  INSERT INTO @ExpectedColumns
    (TableName, ColumnId, ColumnName, SystemTypeId, MaxLength, [Precision], Scale, IsNullable, IsIdentity)
  VALUES
    (N'WebInvoiceDocument', 1, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 2, N'OrderYear', 175, 4, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 3, N'OrderWeek', 175, 5, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 4, N'Revision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceDocument', 5, N'FarmKey', 56, 4, 10, 0, 1, 0),
    (N'WebInvoiceDocument', 6, N'InvoiceNo', 231, 200, 0, 0, 1, 0),
    (N'WebInvoiceDocument', 7, N'InvoiceYear', 175, 4, 0, 0, 1, 0),
    (N'WebInvoiceDocument', 8, N'SourceHash', 173, 32, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 9, N'OriginalFileName', 231, 1040, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 10, N'BusinessKeyHash', 173, 32, 0, 0, 1, 0),
    (N'WebInvoiceDocument', 11, N'ReceiptStatus', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 12, N'CostStatus', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 13, N'RawMetadataJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceDocument', 14, N'ReviewedMetadataJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceDocument', 15, N'CreatedBy', 231, 400, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 16, N'CreatedAt', 42, 7, 23, 3, 0, 0),
    (N'WebInvoiceDocument', 17, N'UpdatedBy', 231, 400, 0, 0, 0, 0),
    (N'WebInvoiceDocument', 18, N'UpdatedAt', 42, 7, 23, 3, 0, 0),
    (N'WebInvoiceDocument', 19, N'RowVersion', 189, 8, 0, 0, 0, 0),

    (N'WebInvoiceLine', 1, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceLine', 2, N'Revision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceLine', 3, N'LineId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceLine', 4, N'LineNo', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceLine', 5, N'OriginalName', 231, 1000, 0, 0, 0, 0),
    (N'WebInvoiceLine', 6, N'LengthText', 231, 200, 0, 0, 1, 0),
    (N'WebInvoiceLine', 7, N'ProdKey', 56, 4, 10, 0, 1, 0),
    (N'WebInvoiceLine', 8, N'BoxQuantity', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceLine', 9, N'BunchQuantity', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceLine', 10, N'StemQuantity', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceLine', 11, N'PriceUnit', 231, 80, 0, 0, 1, 0),
    (N'WebInvoiceLine', 12, N'UnitPrice', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceLine', 13, N'Currency', 175, 3, 0, 0, 1, 0),
    (N'WebInvoiceLine', 14, N'LineAmount', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceLine', 15, N'SourceEvidenceJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceLine', 16, N'ReviewedJson', 231, -1, 0, 0, 1, 0),

    (N'WebInvoiceOperation', 1, N'OperationId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 2, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 3, N'DocumentRevision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceOperation', 4, N'ReceiptPartId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 5, N'RequestHash', 173, 32, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 6, N'Action', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 7, N'Status', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 8, N'WarehouseKey', 56, 4, 10, 0, 1, 0),
    (N'WebInvoiceOperation', 9, N'ResultJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceOperation', 10, N'ErrorCode', 231, 200, 0, 0, 1, 0),
    (N'WebInvoiceOperation', 11, N'Actor', 231, 400, 0, 0, 0, 0),
    (N'WebInvoiceOperation', 12, N'CreatedAt', 42, 7, 23, 3, 0, 0),
    (N'WebInvoiceOperation', 13, N'CompletedAt', 42, 7, 23, 3, 1, 0),

    (N'WebInvoiceHistory', 1, N'HistoryId', 127, 8, 19, 0, 0, 1),
    (N'WebInvoiceHistory', 2, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceHistory', 3, N'Revision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceHistory', 4, N'OperationId', 36, 16, 0, 0, 1, 0),
    (N'WebInvoiceHistory', 5, N'Action', 231, 120, 0, 0, 0, 0),
    (N'WebInvoiceHistory', 6, N'BeforeJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceHistory', 7, N'AfterJson', 231, -1, 0, 0, 1, 0),
    (N'WebInvoiceHistory', 8, N'Reason', 231, 2000, 0, 0, 1, 0),
    (N'WebInvoiceHistory', 9, N'Actor', 231, 400, 0, 0, 0, 0),
    (N'WebInvoiceHistory', 10, N'CreatedAt', 42, 7, 23, 3, 0, 0),

    (N'WebInvoiceCostRevision', 1, N'CostRevisionId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 2, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 3, N'DocumentRevision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostRevision', 4, N'OperationId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 5, N'WarehouseKey', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostRevision', 6, N'RevisionNo', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostRevision', 7, N'Basis', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 8, N'Status', 231, 40, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 9, N'Currency', 175, 3, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 10, N'FormulaId', 231, 200, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 11, N'FormulaVersion', 231, 100, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 12, N'FormulaSourceHash', 173, 32, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 13, N'InputSnapshotJson', 231, -1, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 14, N'ApprovedBy', 231, 400, 0, 0, 1, 0),
    (N'WebInvoiceCostRevision', 15, N'ApprovedAt', 42, 7, 23, 3, 1, 0),
    (N'WebInvoiceCostRevision', 16, N'CreatedBy', 231, 400, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', 17, N'CreatedAt', 42, 7, 23, 3, 0, 0),

    (N'WebInvoiceCostLine', 1, N'CostRevisionId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', 2, N'LineId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', 3, N'DocumentId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', 4, N'DocumentRevision', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostLine', 5, N'OperationId', 36, 16, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', 6, N'WarehouseKey', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostLine', 7, N'WdetailKey', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostLine', 8, N'ProdKey', 56, 4, 10, 0, 0, 0),
    (N'WebInvoiceCostLine', 9, N'Unit', 231, 80, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', 10, N'Quantity', 106, 9, 18, 6, 0, 0),
    (N'WebInvoiceCostLine', 11, N'CostPerUnit', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceCostLine', 12, N'TotalCost', 106, 9, 18, 6, 1, 0),
    (N'WebInvoiceCostLine', 13, N'ComponentAmountsJson', 231, -1, 0, 0, 1, 0);

  IF EXISTS (
    SELECT 1
    FROM @ExpectedColumns AS expected
    LEFT JOIN sys.tables AS tables
      ON tables.schema_id = SCHEMA_ID(N'dbo')
     AND tables.name = expected.TableName
    LEFT JOIN sys.columns AS columns
      ON columns.object_id = tables.object_id
     AND columns.column_id = expected.ColumnId
    WHERE columns.column_id IS NULL
       OR columns.name <> expected.ColumnName
       OR columns.system_type_id <> expected.SystemTypeId
       OR columns.user_type_id <> columns.system_type_id
       OR columns.max_length <> expected.MaxLength
       OR columns.[precision] <> expected.[Precision]
       OR columns.scale <> expected.Scale
       OR columns.is_nullable <> expected.IsNullable
       OR columns.is_identity <> expected.IsIdentity
       OR columns.is_computed <> 0
       OR columns.is_filestream <> 0
       OR columns.is_sparse <> 0
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = tables.name
    JOIN sys.columns AS columns ON columns.object_id = tables.object_id
    LEFT JOIN @ExpectedColumns AS expected
      ON expected.TableName = tables.name
     AND expected.ColumnId = columns.column_id
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
      AND expected.ColumnId IS NULL
  )
  BEGIN
    ;THROW 51005, 'WEB_INVOICE_V1_COLUMN_DRIFT', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expected ON expected.TableName = tables.name
    JOIN sys.identity_columns AS identities ON identities.object_id = tables.object_id
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
      AND (
        tables.name <> N'WebInvoiceHistory'
        OR identities.name <> N'HistoryId'
        OR CONVERT(decimal(38,0), identities.seed_value) <> 1
        OR CONVERT(decimal(38,0), identities.increment_value) <> 1
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM sys.identity_columns
    WHERE object_id = OBJECT_ID(N'dbo.WebInvoiceHistory', N'U')
      AND name = N'HistoryId'
      AND CONVERT(decimal(38,0), seed_value) = 1
      AND CONVERT(decimal(38,0), increment_value) = 1
  )
  BEGIN
    ;THROW 51006, 'WEB_INVOICE_V1_IDENTITY_DRIFT', 1;
  END;

  DECLARE @ExpectedChecks TABLE (
    TableName sysname NOT NULL,
    CheckName sysname NOT NULL,
    PRIMARY KEY (TableName, CheckName)
  );

  INSERT INTO @ExpectedChecks (TableName, CheckName)
  VALUES
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_OrderScope'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_Revision'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_FarmKey'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_InvoiceYear'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_ReceiptStatus'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_CostStatus'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_RequiredText'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_MetadataJson'),
    (N'WebInvoiceDocument', N'CK_WebInvoiceDocument_Times'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_RevisionLineNo'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_RequiredText'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_ProdKey'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_Quantities'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_Currency'),
    (N'WebInvoiceLine', N'CK_WebInvoiceLine_Json'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_DocumentRevision'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_Action'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_Status'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_WarehouseKey'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_CommitState'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_Actor'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_ResultJson'),
    (N'WebInvoiceOperation', N'CK_WebInvoiceOperation_Times'),
    (N'WebInvoiceHistory', N'CK_WebInvoiceHistory_Revision'),
    (N'WebInvoiceHistory', N'CK_WebInvoiceHistory_RequiredText'),
    (N'WebInvoiceHistory', N'CK_WebInvoiceHistory_Json'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_Keys'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_Basis'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_Status'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_Currency'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_RequiredText'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_InputSnapshotJson'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_Approval'),
    (N'WebInvoiceCostRevision', N'CK_WebInvoiceCostRevision_ApprovedState'),
    (N'WebInvoiceCostLine', N'CK_WebInvoiceCostLine_Keys'),
    (N'WebInvoiceCostLine', N'CK_WebInvoiceCostLine_Unit'),
    (N'WebInvoiceCostLine', N'CK_WebInvoiceCostLine_Amounts'),
    (N'WebInvoiceCostLine', N'CK_WebInvoiceCostLine_ComponentAmountsJson');

  IF @CreatedNow = 1
  BEGIN
    DECLARE @CheckTableName sysname;
    DECLARE @CheckName sysname;
    DECLARE @CheckHash varbinary(32);

    DECLARE CheckFingerprintCursor CURSOR LOCAL FAST_FORWARD FOR
      SELECT tables.name,
             checks.name,
             HASHBYTES('SHA2_256', CONVERT(nvarchar(max), checks.definition))
      FROM @ExpectedChecks AS expected
      JOIN sys.tables AS tables
        ON tables.schema_id = SCHEMA_ID(N'dbo')
       AND tables.name = expected.TableName
      JOIN sys.check_constraints AS checks
        ON checks.parent_object_id = tables.object_id
       AND checks.name = expected.CheckName
      ORDER BY tables.name, checks.name;

    OPEN CheckFingerprintCursor;
    FETCH NEXT FROM CheckFingerprintCursor INTO @CheckTableName, @CheckName, @CheckHash;

    WHILE @@FETCH_STATUS = 0
    BEGIN
      EXEC sys.sp_addextendedproperty
        @name = N'NenovaWebInvoiceV1CheckHash',
        @value = @CheckHash,
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE', @level1name = @CheckTableName,
        @level2type = N'CONSTRAINT', @level2name = @CheckName;

      FETCH NEXT FROM CheckFingerprintCursor INTO @CheckTableName, @CheckName, @CheckHash;
    END;

    CLOSE CheckFingerprintCursor;
    DEALLOCATE CheckFingerprintCursor;
  END;

  IF EXISTS (
    SELECT 1
    FROM @ExpectedChecks AS expected
    LEFT JOIN sys.tables AS tables
      ON tables.schema_id = SCHEMA_ID(N'dbo')
     AND tables.name = expected.TableName
    LEFT JOIN sys.check_constraints AS checks
      ON checks.parent_object_id = tables.object_id
     AND checks.name = expected.CheckName
    LEFT JOIN sys.extended_properties AS fingerprints
      ON fingerprints.class = 1
     AND fingerprints.major_id = checks.object_id
     AND fingerprints.minor_id = 0
     AND fingerprints.name = N'NenovaWebInvoiceV1CheckHash'
    WHERE checks.object_id IS NULL
       OR checks.is_disabled = 1
       OR checks.is_not_trusted = 1
       OR fingerprints.major_id IS NULL
       OR fingerprints.value IS NULL
       OR SQL_VARIANT_PROPERTY(fingerprints.value, 'BaseType') <> N'varbinary'
       OR DATALENGTH(CONVERT(varbinary(8000), fingerprints.value)) <> 32
       OR CONVERT(varbinary(32), fingerprints.value)
            <> HASHBYTES('SHA2_256', CONVERT(nvarchar(max), checks.definition))
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = tables.name
    JOIN sys.check_constraints AS checks ON checks.parent_object_id = tables.object_id
    LEFT JOIN @ExpectedChecks AS expected
      ON expected.TableName = tables.name
     AND expected.CheckName = checks.name
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
      AND expected.CheckName IS NULL
  )
  BEGIN
    ;THROW 51007, 'WEB_INVOICE_V1_CHECK_CONSTRAINT_DRIFT', 1;
  END;

  DECLARE @ExpectedIndexes TABLE (
    TableName sysname NOT NULL,
    IndexName sysname NOT NULL,
    IndexType tinyint NOT NULL,
    IsUnique bit NOT NULL,
    IsPrimaryKey bit NOT NULL,
    IsUniqueConstraint bit NOT NULL,
    HasFilter bit NOT NULL,
    PRIMARY KEY (TableName, IndexName)
  );

  INSERT INTO @ExpectedIndexes
    (TableName, IndexName, IndexType, IsUnique, IsPrimaryKey, IsUniqueConstraint, HasFilter)
  VALUES
    (N'WebInvoiceDocument', N'PK_WebInvoiceDocument', 1, 1, 1, 0, 0),
    (N'WebInvoiceDocument', N'UX_WebInvoiceDocument_BusinessKeyHash', 2, 1, 0, 0, 1),
    (N'WebInvoiceDocument', N'IX_WebInvoiceDocument_OrderScope', 2, 0, 0, 0, 0),
    (N'WebInvoiceLine', N'PK_WebInvoiceLine', 1, 1, 1, 0, 0),
    (N'WebInvoiceLine', N'UX_WebInvoiceLine_LineNo', 2, 1, 0, 0, 0),
    (N'WebInvoiceLine', N'IX_WebInvoiceLine_ProdKey', 2, 0, 0, 0, 0),
    (N'WebInvoiceOperation', N'PK_WebInvoiceOperation', 1, 1, 1, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperation', 2, 1, 0, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse', 2, 1, 0, 0, 0),
    (N'WebInvoiceOperation', N'IX_WebInvoiceOperation_DocumentStatus', 2, 0, 0, 0, 0),
    (N'WebInvoiceHistory', N'PK_WebInvoiceHistory', 1, 1, 1, 0, 0),
    (N'WebInvoiceHistory', N'IX_WebInvoiceHistory_DocumentRevision', 2, 0, 0, 0, 0),
    (N'WebInvoiceCostRevision', N'PK_WebInvoiceCostRevision', 1, 1, 1, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_OperationBasisRevision', 2, 1, 0, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 2, 1, 0, 0, 0),
    (N'WebInvoiceCostRevision', N'IX_WebInvoiceCostRevision_Warehouse', 2, 0, 0, 0, 0),
    (N'WebInvoiceCostLine', N'PK_WebInvoiceCostLine', 1, 1, 1, 0, 0),
    (N'WebInvoiceCostLine', N'IX_WebInvoiceCostLine_WarehouseDetail', 2, 0, 0, 0, 0);

  DECLARE @ExpectedIndexColumns TABLE (
    TableName sysname NOT NULL,
    IndexName sysname NOT NULL,
    IndexColumnId int NOT NULL,
    ColumnName sysname NOT NULL,
    KeyOrdinal tinyint NOT NULL,
    IsIncluded bit NOT NULL,
    IsDescending bit NOT NULL,
    PRIMARY KEY (TableName, IndexName, IndexColumnId)
  );

  INSERT INTO @ExpectedIndexColumns
    (TableName, IndexName, IndexColumnId, ColumnName, KeyOrdinal, IsIncluded, IsDescending)
  VALUES
    (N'WebInvoiceDocument', N'PK_WebInvoiceDocument', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceDocument', N'UX_WebInvoiceDocument_BusinessKeyHash', 1, N'BusinessKeyHash', 1, 0, 0),
    (N'WebInvoiceDocument', N'IX_WebInvoiceDocument_OrderScope', 1, N'OrderYear', 1, 0, 0),
    (N'WebInvoiceDocument', N'IX_WebInvoiceDocument_OrderScope', 2, N'OrderWeek', 2, 0, 0),
    (N'WebInvoiceDocument', N'IX_WebInvoiceDocument_OrderScope', 3, N'ReceiptStatus', 3, 0, 0),
    (N'WebInvoiceDocument', N'IX_WebInvoiceDocument_OrderScope', 4, N'DocumentId', 4, 0, 0),
    (N'WebInvoiceLine', N'PK_WebInvoiceLine', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceLine', N'PK_WebInvoiceLine', 2, N'Revision', 2, 0, 0),
    (N'WebInvoiceLine', N'PK_WebInvoiceLine', 3, N'LineId', 3, 0, 0),
    (N'WebInvoiceLine', N'UX_WebInvoiceLine_LineNo', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceLine', N'UX_WebInvoiceLine_LineNo', 2, N'Revision', 2, 0, 0),
    (N'WebInvoiceLine', N'UX_WebInvoiceLine_LineNo', 3, N'LineNo', 3, 0, 0),
    (N'WebInvoiceLine', N'IX_WebInvoiceLine_ProdKey', 1, N'ProdKey', 1, 0, 0),
    (N'WebInvoiceLine', N'IX_WebInvoiceLine_ProdKey', 2, N'DocumentId', 2, 0, 0),
    (N'WebInvoiceLine', N'IX_WebInvoiceLine_ProdKey', 3, N'Revision', 3, 0, 0),
    (N'WebInvoiceOperation', N'PK_WebInvoiceOperation', 1, N'OperationId', 1, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperation', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperation', 2, N'DocumentRevision', 2, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperation', 3, N'OperationId', 3, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse', 2, N'DocumentRevision', 2, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse', 3, N'OperationId', 3, 0, 0),
    (N'WebInvoiceOperation', N'UX_WebInvoiceOperation_DocumentRevisionOperationWarehouse', 4, N'WarehouseKey', 4, 0, 0),
    (N'WebInvoiceOperation', N'IX_WebInvoiceOperation_DocumentStatus', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceOperation', N'IX_WebInvoiceOperation_DocumentStatus', 2, N'Status', 2, 0, 0),
    (N'WebInvoiceOperation', N'IX_WebInvoiceOperation_DocumentStatus', 3, N'CreatedAt', 3, 0, 0),
    (N'WebInvoiceOperation', N'IX_WebInvoiceOperation_DocumentStatus', 4, N'OperationId', 4, 0, 0),
    (N'WebInvoiceHistory', N'PK_WebInvoiceHistory', 1, N'HistoryId', 1, 0, 0),
    (N'WebInvoiceHistory', N'IX_WebInvoiceHistory_DocumentRevision', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceHistory', N'IX_WebInvoiceHistory_DocumentRevision', 2, N'Revision', 2, 0, 0),
    (N'WebInvoiceHistory', N'IX_WebInvoiceHistory_DocumentRevision', 3, N'CreatedAt', 3, 0, 0),
    (N'WebInvoiceHistory', N'IX_WebInvoiceHistory_DocumentRevision', 4, N'HistoryId', 4, 0, 0),
    (N'WebInvoiceCostRevision', N'PK_WebInvoiceCostRevision', 1, N'CostRevisionId', 1, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_OperationBasisRevision', 1, N'DocumentId', 1, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_OperationBasisRevision', 2, N'OperationId', 2, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_OperationBasisRevision', 3, N'Basis', 3, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_OperationBasisRevision', 4, N'RevisionNo', 4, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 1, N'CostRevisionId', 1, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 2, N'DocumentId', 2, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 3, N'DocumentRevision', 3, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 4, N'OperationId', 4, 0, 0),
    (N'WebInvoiceCostRevision', N'UX_WebInvoiceCostRevision_LineScope', 5, N'WarehouseKey', 5, 0, 0),
    (N'WebInvoiceCostRevision', N'IX_WebInvoiceCostRevision_Warehouse', 1, N'WarehouseKey', 1, 0, 0),
    (N'WebInvoiceCostRevision', N'IX_WebInvoiceCostRevision_Warehouse', 2, N'Status', 2, 0, 0),
    (N'WebInvoiceCostRevision', N'IX_WebInvoiceCostRevision_Warehouse', 3, N'CreatedAt', 3, 0, 0),
    (N'WebInvoiceCostRevision', N'IX_WebInvoiceCostRevision_Warehouse', 4, N'CostRevisionId', 4, 0, 0),
    (N'WebInvoiceCostLine', N'PK_WebInvoiceCostLine', 1, N'CostRevisionId', 1, 0, 0),
    (N'WebInvoiceCostLine', N'PK_WebInvoiceCostLine', 2, N'LineId', 2, 0, 0),
    (N'WebInvoiceCostLine', N'IX_WebInvoiceCostLine_WarehouseDetail', 1, N'WarehouseKey', 1, 0, 0),
    (N'WebInvoiceCostLine', N'IX_WebInvoiceCostLine_WarehouseDetail', 2, N'WdetailKey', 2, 0, 0),
    (N'WebInvoiceCostLine', N'IX_WebInvoiceCostLine_WarehouseDetail', 3, N'ProdKey', 3, 0, 0),
    (N'WebInvoiceCostLine', N'IX_WebInvoiceCostLine_WarehouseDetail', 4, N'CostRevisionId', 4, 0, 0);

  IF EXISTS (
    SELECT 1
    FROM @ExpectedIndexes AS expected
    LEFT JOIN sys.tables AS tables
      ON tables.schema_id = SCHEMA_ID(N'dbo')
     AND tables.name = expected.TableName
    LEFT JOIN sys.indexes AS indexes
      ON indexes.object_id = tables.object_id
     AND indexes.name = expected.IndexName
    WHERE indexes.index_id IS NULL
       OR indexes.[type] <> expected.IndexType
       OR indexes.is_unique <> expected.IsUnique
       OR indexes.is_primary_key <> expected.IsPrimaryKey
       OR indexes.is_unique_constraint <> expected.IsUniqueConstraint
       OR indexes.has_filter <> expected.HasFilter
       OR indexes.is_disabled = 1
       OR indexes.is_hypothetical = 1
       OR indexes.ignore_dup_key = 1
       OR (
         expected.HasFilter = 1
         AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
               indexes.filter_definition,
               N'[', N''), N']', N''), N'(', N''), N')', N''),
               N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'')
             <> N'BusinessKeyHashISNOTNULL'
       )
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = tables.name
    JOIN sys.indexes AS indexes
      ON indexes.object_id = tables.object_id
     AND indexes.index_id > 0
     AND indexes.is_hypothetical = 0
    LEFT JOIN @ExpectedIndexes AS expected
      ON expected.TableName = tables.name
     AND expected.IndexName = indexes.name
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
      AND expected.IndexName IS NULL
  )
  BEGIN
    ;THROW 51008, 'WEB_INVOICE_V1_INDEX_DRIFT', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM @ExpectedIndexColumns AS expected
    LEFT JOIN sys.tables AS tables
      ON tables.schema_id = SCHEMA_ID(N'dbo')
     AND tables.name = expected.TableName
    LEFT JOIN sys.indexes AS indexes
      ON indexes.object_id = tables.object_id
     AND indexes.name = expected.IndexName
    LEFT JOIN sys.index_columns AS indexColumns
      ON indexColumns.object_id = indexes.object_id
     AND indexColumns.index_id = indexes.index_id
     AND indexColumns.index_column_id = expected.IndexColumnId
    LEFT JOIN sys.columns AS columns
      ON columns.object_id = indexColumns.object_id
     AND columns.column_id = indexColumns.column_id
    WHERE indexColumns.index_column_id IS NULL
       OR columns.name <> expected.ColumnName
       OR indexColumns.key_ordinal <> expected.KeyOrdinal
       OR indexColumns.is_included_column <> expected.IsIncluded
       OR indexColumns.is_descending_key <> expected.IsDescending
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = tables.name
    JOIN sys.indexes AS indexes ON indexes.object_id = tables.object_id AND indexes.index_id > 0
    JOIN sys.index_columns AS indexColumns
      ON indexColumns.object_id = indexes.object_id
     AND indexColumns.index_id = indexes.index_id
    LEFT JOIN @ExpectedIndexColumns AS expected
      ON expected.TableName = tables.name
     AND expected.IndexName = indexes.name
     AND expected.IndexColumnId = indexColumns.index_column_id
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
      AND expected.IndexColumnId IS NULL
  )
  BEGIN
    ;THROW 51009, 'WEB_INVOICE_V1_INDEX_COLUMN_DRIFT', 1;
  END;

  DECLARE @ExpectedForeignKeys TABLE (
    ChildTable sysname NOT NULL,
    ForeignKeyName sysname NOT NULL,
    ParentTable sysname NOT NULL,
    PRIMARY KEY (ChildTable, ForeignKeyName)
  );

  INSERT INTO @ExpectedForeignKeys (ChildTable, ForeignKeyName, ParentTable)
  VALUES
    (N'WebInvoiceLine', N'FK_WebInvoiceLine_Document', N'WebInvoiceDocument'),
    (N'WebInvoiceOperation', N'FK_WebInvoiceOperation_Document', N'WebInvoiceDocument'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_Document', N'WebInvoiceDocument'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_OperationScope', N'WebInvoiceOperation'),
    (N'WebInvoiceCostRevision', N'FK_WebInvoiceCostRevision_OperationScope', N'WebInvoiceOperation'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', N'WebInvoiceCostRevision'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_SourceLine', N'WebInvoiceLine');

  DECLARE @ExpectedForeignKeyColumns TABLE (
    ChildTable sysname NOT NULL,
    ForeignKeyName sysname NOT NULL,
    ConstraintColumnId int NOT NULL,
    ChildColumn sysname NOT NULL,
    ParentColumn sysname NOT NULL,
    PRIMARY KEY (ChildTable, ForeignKeyName, ConstraintColumnId)
  );

  INSERT INTO @ExpectedForeignKeyColumns
    (ChildTable, ForeignKeyName, ConstraintColumnId, ChildColumn, ParentColumn)
  VALUES
    (N'WebInvoiceLine', N'FK_WebInvoiceLine_Document', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceOperation', N'FK_WebInvoiceOperation_Document', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_Document', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_OperationScope', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_OperationScope', 2, N'Revision', N'DocumentRevision'),
    (N'WebInvoiceHistory', N'FK_WebInvoiceHistory_OperationScope', 3, N'OperationId', N'OperationId'),
    (N'WebInvoiceCostRevision', N'FK_WebInvoiceCostRevision_OperationScope', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceCostRevision', N'FK_WebInvoiceCostRevision_OperationScope', 2, N'DocumentRevision', N'DocumentRevision'),
    (N'WebInvoiceCostRevision', N'FK_WebInvoiceCostRevision_OperationScope', 3, N'OperationId', N'OperationId'),
    (N'WebInvoiceCostRevision', N'FK_WebInvoiceCostRevision_OperationScope', 4, N'WarehouseKey', N'WarehouseKey'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', 1, N'CostRevisionId', N'CostRevisionId'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', 2, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', 3, N'DocumentRevision', N'DocumentRevision'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', 4, N'OperationId', N'OperationId'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_CostRevisionScope', 5, N'WarehouseKey', N'WarehouseKey'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_SourceLine', 1, N'DocumentId', N'DocumentId'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_SourceLine', 2, N'DocumentRevision', N'Revision'),
    (N'WebInvoiceCostLine', N'FK_WebInvoiceCostLine_SourceLine', 3, N'LineId', N'LineId');

  IF EXISTS (
    SELECT 1
    FROM @ExpectedForeignKeys AS expected
    LEFT JOIN sys.tables AS childTable
      ON childTable.schema_id = SCHEMA_ID(N'dbo')
     AND childTable.name = expected.ChildTable
    LEFT JOIN sys.foreign_keys AS foreignKeys
      ON foreignKeys.parent_object_id = childTable.object_id
     AND foreignKeys.name = expected.ForeignKeyName
    LEFT JOIN sys.tables AS parentTable
      ON parentTable.object_id = foreignKeys.referenced_object_id
    WHERE foreignKeys.object_id IS NULL
       OR parentTable.schema_id <> SCHEMA_ID(N'dbo')
       OR parentTable.name <> expected.ParentTable
       OR foreignKeys.delete_referential_action <> 0
       OR foreignKeys.update_referential_action <> 0
       OR foreignKeys.is_disabled = 1
       OR foreignKeys.is_not_trusted = 1
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS childTable
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = childTable.name
    JOIN sys.foreign_keys AS foreignKeys ON foreignKeys.parent_object_id = childTable.object_id
    LEFT JOIN @ExpectedForeignKeys AS expected
      ON expected.ChildTable = childTable.name
     AND expected.ForeignKeyName = foreignKeys.name
    WHERE childTable.schema_id = SCHEMA_ID(N'dbo')
      AND expected.ForeignKeyName IS NULL
  )
  BEGIN
    ;THROW 51010, 'WEB_INVOICE_V1_FOREIGN_KEY_DRIFT', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM @ExpectedForeignKeyColumns AS expected
    LEFT JOIN sys.tables AS childTable
      ON childTable.schema_id = SCHEMA_ID(N'dbo')
     AND childTable.name = expected.ChildTable
    LEFT JOIN sys.foreign_keys AS foreignKeys
      ON foreignKeys.parent_object_id = childTable.object_id
     AND foreignKeys.name = expected.ForeignKeyName
    LEFT JOIN sys.foreign_key_columns AS foreignKeyColumns
      ON foreignKeyColumns.constraint_object_id = foreignKeys.object_id
     AND foreignKeyColumns.constraint_column_id = expected.ConstraintColumnId
    LEFT JOIN sys.columns AS childColumn
      ON childColumn.object_id = foreignKeyColumns.parent_object_id
     AND childColumn.column_id = foreignKeyColumns.parent_column_id
    LEFT JOIN sys.columns AS parentColumn
      ON parentColumn.object_id = foreignKeyColumns.referenced_object_id
     AND parentColumn.column_id = foreignKeyColumns.referenced_column_id
    WHERE foreignKeyColumns.constraint_column_id IS NULL
       OR childColumn.name <> expected.ChildColumn
       OR parentColumn.name <> expected.ParentColumn
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS childTable
    JOIN @ExpectedTables AS expectedTable ON expectedTable.TableName = childTable.name
    JOIN sys.foreign_keys AS foreignKeys ON foreignKeys.parent_object_id = childTable.object_id
    JOIN sys.foreign_key_columns AS foreignKeyColumns
      ON foreignKeyColumns.constraint_object_id = foreignKeys.object_id
    LEFT JOIN @ExpectedForeignKeyColumns AS expected
      ON expected.ChildTable = childTable.name
     AND expected.ForeignKeyName = foreignKeys.name
     AND expected.ConstraintColumnId = foreignKeyColumns.constraint_column_id
    WHERE childTable.schema_id = SCHEMA_ID(N'dbo')
      AND expected.ConstraintColumnId IS NULL
  )
  BEGIN
    ;THROW 51011, 'WEB_INVOICE_V1_FOREIGN_KEY_COLUMN_DRIFT', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expected ON expected.TableName = tables.name
    JOIN sys.default_constraints AS defaults ON defaults.parent_object_id = tables.object_id
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
  ) OR EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    JOIN @ExpectedTables AS expected ON expected.TableName = tables.name
    JOIN sys.triggers AS triggers ON triggers.parent_id = tables.object_id
    WHERE tables.schema_id = SCHEMA_ID(N'dbo')
  )
  BEGIN
    ;THROW 51012, 'WEB_INVOICE_V1_UNEXPECTED_DEFAULT_OR_TRIGGER', 1;
  END;

  IF @CreatedNow = 1
  BEGIN
    DECLARE @CreatedTablesHaveRows bit = 0;

    EXEC sys.sp_executesql
      N'SELECT @HasRows = CASE WHEN
          EXISTS (SELECT 1 FROM dbo.WebInvoiceDocument)
          OR EXISTS (SELECT 1 FROM dbo.WebInvoiceLine)
          OR EXISTS (SELECT 1 FROM dbo.WebInvoiceOperation)
          OR EXISTS (SELECT 1 FROM dbo.WebInvoiceHistory)
          OR EXISTS (SELECT 1 FROM dbo.WebInvoiceCostRevision)
          OR EXISTS (SELECT 1 FROM dbo.WebInvoiceCostLine)
        THEN 1 ELSE 0 END;',
      N'@HasRows bit OUTPUT',
      @HasRows = @CreatedTablesHaveRows OUTPUT;

    IF @CreatedTablesHaveRows = 1
    BEGIN
      ;THROW 51013, 'WEB_INVOICE_V1_CREATION_WAS_NOT_EMPTY', 1;
    END;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
  BEGIN
    ROLLBACK TRANSACTION;
  END;

  THROW;
END CATCH;
