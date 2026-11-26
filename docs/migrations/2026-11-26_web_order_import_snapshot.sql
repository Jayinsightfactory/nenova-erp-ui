-- Idempotent DDL for WebOrderImportSnapshot (web-only snapshot of upload order registrations).
-- Preserves all ERP master/detail tables (OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail).
IF OBJECT_ID(N'dbo.WebOrderImportSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebOrderImportSnapshot (
    SnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear INT NOT NULL,
    OrderWeek NVARCHAR(20) NOT NULL,
    CustKey INT NOT NULL,
    CustName NVARCHAR(200) NULL,
    SnapshotKind NVARCHAR(30) NOT NULL DEFAULT N'UPLOAD_REGISTER',
    FileName NVARCHAR(300) NULL,
    SheetName NVARCHAR(200) NULL,
    SourceType NVARCHAR(40) NULL,
    ItemCount INT NOT NULL DEFAULT 0,
    TotalQty DECIMAL(18, 4) NOT NULL DEFAULT 0,
    ItemsJson NVARCHAR(MAX) NOT NULL,
    SheetPreviewJson NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2(0) NOT NULL DEFAULT GETDATE(),
    IsDeleted BIT NOT NULL DEFAULT 0
  );
  CREATE INDEX IX_WebOrderImportSnapshot_Lookup
    ON dbo.WebOrderImportSnapshot (OrderYear, OrderWeek, CustKey, IsDeleted, CreatedAt);
END;
