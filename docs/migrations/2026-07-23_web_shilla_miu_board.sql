/* 신라·미우 통합 게시판 웹 매칭 원장
   전산 주문·입고·출고 원장은 수정하지 않고, 공급차수→사용차수 및 라움·미우 매칭/하이라이트만 저장한다. */
IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebShillaMiuBoardAllocation (
    BoardKey BIGINT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    SupplyWeek NVARCHAR(4) NOT NULL,
    UseWeek NVARCHAR(4) NOT NULL,
    ProdKey INT NOT NULL,
    Destination NVARCHAR(10) NOT NULL,
    Qty DECIMAL(18,3) NOT NULL DEFAULT 0,
    Matched BIT NOT NULL DEFAULT 0,
    Memo NVARCHAR(500) NOT NULL DEFAULT N'',
    CreatedBy NVARCHAR(50) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy NVARCHAR(50) NULL,
    UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    isDeleted BIT NOT NULL DEFAULT 0
  );
  CREATE INDEX IX_WebShillaMiuBoardAllocation_Scope
    ON dbo.WebShillaMiuBoardAllocation(OrderYear, UseWeek, ProdKey, Destination, isDeleted);
END;
