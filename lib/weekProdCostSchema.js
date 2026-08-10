// 웹 전용 차수별 단가도 OrderWeek가 매년 반복되는 ERP 업무키 규칙을 따른다.
// 기존 행은 어느 연도인지 추정할 수 없으므로 NULL로 남기고, 신규 저장/조회만
// 명시 OrderYear를 사용한다.
export const WEEK_PROD_COST_SCHEMA_SQL = `
IF OBJECT_ID(N'dbo.WeekProdCost', N'U') IS NULL
BEGIN
  CREATE TABLE WeekProdCost (
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
  CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
    ON WeekProdCost(OrderYear, OrderWeek, CustKey, ProdKey);
END
ELSE IF COL_LENGTH(N'dbo.WeekProdCost', N'OrderYear') IS NULL
BEGIN
  ALTER TABLE WeekProdCost ADD OrderYear NVARCHAR(4) NULL;
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.WeekProdCost')
      AND name = N'IX_WeekProdCost_Lookup'
  )
    DROP INDEX IX_WeekProdCost_Lookup ON WeekProdCost;
  CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
    ON WeekProdCost(OrderYear, OrderWeek, CustKey, ProdKey);
END
ELSE IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes i
    JOIN sys.index_columns ic
      ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c
      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
   WHERE i.object_id = OBJECT_ID(N'dbo.WeekProdCost')
     AND i.name = N'IX_WeekProdCost_Lookup'
     AND c.name = N'OrderYear'
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.WeekProdCost')
      AND name = N'IX_WeekProdCost_Lookup'
  )
    DROP INDEX IX_WeekProdCost_Lookup ON WeekProdCost;
  CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
    ON WeekProdCost(OrderYear, OrderWeek, CustKey, ProdKey);
END`;

export const WEEK_PROD_COST_YEAR_PROBE_SQL = `
SELECT CASE WHEN OBJECT_ID(N'dbo.WeekProdCost', N'U') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WeekProdCost', N'OrderYear') IS NOT NULL
            THEN 1 ELSE 0 END AS ok`;
