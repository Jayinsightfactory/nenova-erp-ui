-- 영업수입불량차감 웹 원장 + 변경 이력
-- API도 동일 DDL을 idempotent ensure 한다. 운영 DB에 먼저 실행해도 안전하다.

IF OBJECT_ID(N'dbo.WebSalesDefectDeduction', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebSalesDefectDeduction (
    DeductionKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear INT NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    CustKey INT NULL,
    CustName NVARCHAR(200) NOT NULL DEFAULT N'',
    ProdKey INT NULL,
    ProdName NVARCHAR(300) NOT NULL DEFAULT N'',
    ColorName NVARCHAR(200) NOT NULL DEFAULT N'',
    Quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
    SourceUnit NVARCHAR(30) NOT NULL DEFAULT N'',
    CreditApplied BIT NOT NULL DEFAULT 0,
    FarmKey INT NULL,
    FarmName NVARCHAR(200) NOT NULL DEFAULT N'',
    Note NVARCHAR(1000) NOT NULL DEFAULT N'',
    DeductionType NVARCHAR(50) NOT NULL DEFAULT N'불량차감',
    EstimateKey INT NULL,
    EstimateCost DECIMAL(18,4) NULL,
    EstimateDtm DATETIME NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'DRAFT',
    SourceFileName NVARCHAR(300) NOT NULL DEFAULT N'',
    CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    UpdatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
    UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    IsDeleted BIT NOT NULL DEFAULT 0,
    DeletedBy NVARCHAR(100) NULL,
    DeletedAt DATETIME NULL,
    RowVersionNo INT NOT NULL DEFAULT 1
  );
  CREATE INDEX IX_WebSalesDefectDeduction_Week
    ON dbo.WebSalesDefectDeduction(OrderYear, OrderWeek, IsDeleted, CustKey);
  CREATE INDEX IX_WebSalesDefectDeduction_Estimate
    ON dbo.WebSalesDefectDeduction(EstimateKey) WHERE EstimateKey IS NOT NULL;
END;

IF OBJECT_ID(N'dbo.WebSalesDefectDeductionHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebSalesDefectDeductionHistory (
    HistoryKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DeductionKey INT NOT NULL,
    ActionType NVARCHAR(30) NOT NULL,
    ChangedBy NVARCHAR(100) NOT NULL DEFAULT N'',
    ChangedByName NVARCHAR(100) NOT NULL DEFAULT N'',
    ChangedAt DATETIME NOT NULL DEFAULT GETDATE(),
    ChangeSummary NVARCHAR(1000) NOT NULL DEFAULT N'',
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NULL
  );
  CREATE INDEX IX_WebSalesDefectDeductionHistory_Row
    ON dbo.WebSalesDefectDeductionHistory(DeductionKey, ChangedAt DESC);
END;

