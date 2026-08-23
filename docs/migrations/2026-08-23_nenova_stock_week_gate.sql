-- 2026-08-23: 출고확정/취소/재고계산 직렬화 게이트
-- EXE·웹이 같은 SP를 타므로, 취소 직후 다음 차수 취소를 재계산 끝날 때까지 막는다.
-- 고정 WAITFOR DELAY 가 아니라 상태 행으로 대기한다. 90초 지나면 만료.
-- 취소 SP 안에 usp_StockCalculation 을 넣지 않는다.

IF OBJECT_ID(N'dbo.NenovaStockWeekGate', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.NenovaStockWeekGate (
    GateKey    char(1)      NOT NULL CONSTRAINT PK_NenovaStockWeekGate PRIMARY KEY,
    Mode       nvarchar(20) NULL,  -- NULL | RUN | WAIT_CALC
    LockedAt   datetime     NULL,
    Action     nvarchar(20) NULL,  -- FIX | CANCEL | CALC
    OrderYear  nvarchar(20) NULL,
    OrderWeek  nvarchar(20) NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.NenovaStockWeekGate WHERE GateKey = '1')
  INSERT INTO dbo.NenovaStockWeekGate (GateKey, Mode) VALUES ('1', NULL);
GO

CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateEnter
  @Action    nvarchar(20),
  @OrderYear nvarchar(20),
  @OrderWeek nvarchar(20),
  @oResult   int          OUTPUT,
  @oMessage  nvarchar(200) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @oResult = 0;
  SET @oMessage = N'';

  DECLARE @try int = 0;
  WHILE @try < 90
  BEGIN
    UPDATE dbo.NenovaStockWeekGate
       SET Mode     = N'RUN',
           LockedAt = GETDATE(),
           Action   = @Action,
           OrderYear = @OrderYear,
           OrderWeek = @OrderWeek
     WHERE GateKey = '1'
       AND (
            Mode IS NULL
         OR LockedAt < DATEADD(SECOND, -90, GETDATE())
         OR (@Action = N'CALC' AND Mode = N'WAIT_CALC')
       );
    IF @@ROWCOUNT = 1 RETURN;

    WAITFOR DELAY '00:00:01';
    SET @try += 1;
  END

  SET @oResult = -99;
  SET @oMessage = N'재고 재계산/확정 작업이 진행 중입니다. 잠시 후 다시 시도하세요.';
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateLeave
  @Action  nvarchar(20),
  @Success bit
AS
BEGIN
  SET NOCOUNT ON;
  IF @Action IN (N'FIX', N'CANCEL') AND @Success = 1
    UPDATE dbo.NenovaStockWeekGate
       SET Mode = N'WAIT_CALC', LockedAt = GETDATE(), Action = @Action
     WHERE GateKey = '1';
  ELSE
    UPDATE dbo.NenovaStockWeekGate
       SET Mode = NULL, LockedAt = NULL, Action = NULL, OrderYear = NULL, OrderWeek = NULL
     WHERE GateKey = '1';
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_NenovaStockWeekGateClear
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.NenovaStockWeekGate
     SET Mode = NULL, LockedAt = NULL, Action = NULL, OrderYear = NULL, OrderWeek = NULL
   WHERE GateKey = '1';
END
GO
