/* 수입부 Pivot 농장별 결제일 설정 — 웹 전용
   5/15/25/30일 중 하나를 농장명별로 저장한다.
   WarehouseMaster/WarehouseDetail 및 주문·출고·재고 원장은 변경하지 않는다. */
IF OBJECT_ID(N'dbo.WebImportFarmPaymentDay', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebImportFarmPaymentDay (
    FarmName NVARCHAR(120) NOT NULL,
    PaymentDay TINYINT NOT NULL,
    CreateID NVARCHAR(50) NOT NULL,
    CreateDtm DATETIME NOT NULL CONSTRAINT DF_WebImportFarmPaymentDay_CreateDtm DEFAULT GETDATE(),
    UpdateID NVARCHAR(50) NOT NULL,
    UpdateDtm DATETIME NOT NULL CONSTRAINT DF_WebImportFarmPaymentDay_UpdateDtm DEFAULT GETDATE(),
    CONSTRAINT PK_WebImportFarmPaymentDay PRIMARY KEY (FarmName),
    CONSTRAINT CK_WebImportFarmPaymentDay_Day CHECK (PaymentDay IN (5, 15, 25, 30))
  );
END;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
   WHERE parent_object_id = OBJECT_ID(N'dbo.WebImportFarmPaymentDay')
     AND name = N'CK_WebImportFarmPaymentDay_Day'
     AND definition NOT LIKE N'%30%'
)
  ALTER TABLE dbo.WebImportFarmPaymentDay DROP CONSTRAINT CK_WebImportFarmPaymentDay_Day;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
   WHERE parent_object_id = OBJECT_ID(N'dbo.WebImportFarmPaymentDay')
     AND name = N'CK_WebImportFarmPaymentDay_Day'
)
  ALTER TABLE dbo.WebImportFarmPaymentDay
    ADD CONSTRAINT CK_WebImportFarmPaymentDay_Day CHECK (PaymentDay IN (5, 15, 25, 30));

/* 수입부 Pivot 수기 조정 및 포워더 인보이스 웹 전용 원장.
   API GET은 이 migration이 생성한 테이블을 SELECT만 한다. */
IF OBJECT_ID(N'dbo.WebImportPivotAdj', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebImportPivotAdj (
    AutoKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    Awb NVARCHAR(60) NOT NULL DEFAULT N'',
    InvoiceNo NVARCHAR(60) NOT NULL DEFAULT N'',
    FarmName NVARCHAR(120) NOT NULL DEFAULT N'',
    Label NVARCHAR(120) NOT NULL,
    RefNo NVARCHAR(120) NOT NULL DEFAULT N'',
    Amount FLOAT NOT NULL,
    CreateID NVARCHAR(50) NOT NULL,
    CreateDtm DATETIME NOT NULL DEFAULT GETDATE(),
    isDeleted BIT NOT NULL DEFAULT 0
  );
END;

IF OBJECT_ID(N'dbo.WebForwarderInvoice', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebForwarderInvoice (
    AutoKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    Awb NVARCHAR(60) NOT NULL,
    InvoiceNo NVARCHAR(120) NOT NULL,
    CreateID NVARCHAR(50) NOT NULL,
    CreateDtm DATETIME NOT NULL DEFAULT GETDATE(),
    isDeleted BIT NOT NULL DEFAULT 0
  );
END;
