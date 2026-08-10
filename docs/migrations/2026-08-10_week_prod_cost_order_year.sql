-- WeekProdCost는 웹 전용 단가 보조 테이블이지만 OrderWeek가 매년 반복되므로
-- 신규 조회/저장 업무키를 OrderYear + OrderWeek + CustKey + ProdKey로 고정한다.
-- 기존 연도 미상 행은 추정 보정하지 않고 NULL로 보존한다.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WeekProdCost', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WeekProdCost (
    AutoKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    CustKey INT NOT NULL,
    ProdKey INT NOT NULL,
    Cost FLOAT NOT NULL,
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE(),
    UpdatedBy NVARCHAR(50)
  );
END
ELSE IF COL_LENGTH(N'dbo.WeekProdCost', N'OrderYear') IS NULL
BEGIN
  ALTER TABLE dbo.WeekProdCost ADD OrderYear NVARCHAR(4) NULL;
END;

IF EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id=OBJECT_ID(N'dbo.WeekProdCost')
     AND name=N'IX_WeekProdCost_Lookup'
)
  DROP INDEX IX_WeekProdCost_Lookup ON dbo.WeekProdCost;

CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
  ON dbo.WeekProdCost(OrderYear, OrderWeek, CustKey, ProdKey);

COMMIT TRANSACTION;
