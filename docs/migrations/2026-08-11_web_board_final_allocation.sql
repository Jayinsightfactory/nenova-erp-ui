/* 잔량분배 게시판 — 업체 최종분배(웹 전용) 컬럼과 감사 이력
   2026-08-11
   - 기존 Qty(이전 정의의 '이동입력')는 보존하고 의미가 다른 새 값은 FinalQty에 저장한다.
   - FinalQty IS NULL = 아직 사용자가 최종분배를 입력하지 않음.
   - ERP 원장(Order*/Shipment*/Stock*/Estimate/WebProfitReport)은 이 마이그레이션과 무관하다.
   - idempotent: 여러 번 실행해도 안전하다. */

IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation', N'U') IS NULL
  RAISERROR(N'먼저 2026-07-23_web_shilla_miu_board.sql 을 실행하세요.', 16, 1);

IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation', 'FinalQty') IS NULL
  ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD FinalQty DECIMAL(18,3) NULL;

/* 저장 시점의 ERP 예상물량/현재분배 스냅샷 — 나중에 왜 그 값을 입력했는지 추적용(표시 계산에는 쓰지 않음) */
IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation', 'ExpectedQtyAtSave') IS NULL
  ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD ExpectedQtyAtSave DECIMAL(18,3) NULL;
IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation', 'CurrentQtyAtSave') IS NULL
  ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD CurrentQtyAtSave DECIMAL(18,3) NULL;

IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocationHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebShillaMiuBoardAllocationHistory (
    HistoryKey BIGINT IDENTITY(1,1) PRIMARY KEY,
    BoardKey BIGINT NULL,
    OrderYear NVARCHAR(4) NOT NULL,
    UseWeek NVARCHAR(4) NOT NULL,
    GroupKey INT NULL,
    ProdKey INT NOT NULL,
    ChangeType NVARCHAR(20) NOT NULL,
    BeforeFinalQty DECIMAL(18,3) NULL,
    AfterFinalQty DECIMAL(18,3) NULL,
    BeforeMatched BIT NULL,
    AfterMatched BIT NULL,
    LegacyMoveQty DECIMAL(18,3) NULL,
    ExpectedQty DECIMAL(18,3) NULL,
    CurrentQty DECIMAL(18,3) NULL,
    Memo NVARCHAR(500) NULL,
    ActedBy NVARCHAR(50) NULL,
    ActedAt DATETIME NOT NULL DEFAULT GETDATE()
  );
  CREATE INDEX IX_WebShillaMiuBoardAllocationHistory_Scope
    ON dbo.WebShillaMiuBoardAllocationHistory(OrderYear, UseWeek, GroupKey, ProdKey, ActedAt);
END;
