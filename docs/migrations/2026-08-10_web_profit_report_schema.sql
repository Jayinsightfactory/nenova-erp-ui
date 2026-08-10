-- 주차별 매출이익보고서 웹 전용 원장.
-- lib/profitReport.js의 기존 ensure DDL과 동일하며 반복 실행할 수 있다.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebProfitReport')
BEGIN
  CREATE TABLE WebProfitReport (
    AutoKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(4) NOT NULL,
    Category NVARCHAR(60) NOT NULL,
    ColKey NVARCHAR(20) NOT NULL,
    Value FLOAT NULL,
    TextValue NVARCHAR(2000) NULL,
    UpdatedBy NVARCHAR(50),
    UpdatedAt DATETIME DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_WebProfitReport ON WebProfitReport(OrderYear, MajorWeek, Category, ColKey);
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebStockPrice')
BEGIN
  CREATE TABLE WebStockPrice (
    ProdKey INT PRIMARY KEY,
    Price FLOAT NOT NULL,
    UpdatedBy NVARCHAR(50),
    UpdatedAt DATETIME DEFAULT GETDATE()
  );
END;
