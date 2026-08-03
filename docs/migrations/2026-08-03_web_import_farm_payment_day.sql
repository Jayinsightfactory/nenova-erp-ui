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
