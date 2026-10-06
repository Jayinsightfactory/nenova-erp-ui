-- Isolated fixture only: exact operational definitions captured read-only 2026-10-06.
-- Never deploy these objects to production. The fixture harness uses a new loopback database.

CREATE   PROCEDURE dbo.usp_NenovaStockWeekGateEnter
  @Action nvarchar(20), @OrderYear nvarchar(20), @OrderWeek nvarchar(20),
  @oResult int OUTPUT, @oMessage nvarchar(200) OUTPUT,
  @ProtocolVersion int=NULL, @OwnerToken uniqueidentifier=NULL OUTPUT, @CalcProdKey int=NULL
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: never infer ownership from SPID alone.
  SET NOCOUNT ON;
  SET @OwnerToken=NULL;
  SET @oResult=-99;
  SET @oMessage=N'STOCK_GATE_BUSY_OR_PENDING_CALC';
  IF ISNULL(@ProtocolVersion,0)<>2
  BEGIN SET @oResult=-98; SET @oMessage=N'STOCK_GATE_OWNER_PROTOCOL_REQUIRED'; RETURN; END;
  IF @Action IS NULL OR @Action NOT IN(N'FIX',N'CANCEL',N'CALC')
    OR @OrderYear IS NULL OR LEN(@OrderYear)<>4 OR @OrderYear LIKE N'%[^0-9]%'
    OR @OrderWeek IS NULL OR LEN(@OrderWeek)<>5 OR @OrderWeek NOT LIKE N'[0-9][0-9]-[0-9][0-9]'
    OR (@Action=N'CALC' AND (@CalcProdKey IS NULL OR @CalcProdKey<0))
    OR (@Action<>N'CALC' AND @CalcProdKey IS NOT NULL)
  BEGIN SET @oResult=-98; SET @oMessage=N'STOCK_GATE_SCOPE_INVALID'; RETURN; END;
  DECLARE @newToken uniqueidentifier=NEWID(), @changed int;
  BEGIN TRY
    UPDATE dbo.NenovaStockWeekGate WITH (UPDLOCK,ROWLOCK,NOWAIT)
       SET Mode=N'RUN', LockedAt=GETDATE(), Action=@Action,
           OrderYear=@OrderYear, OrderWeek=@OrderWeek,
           OwnerSessionID=@@SPID, OwnerToken=@newToken, CalcProdKey=@CalcProdKey
     WHERE GateKey='1' AND ProtocolVersion=2 AND (
       (Mode IS NULL AND PendingCalc=0 AND OwnerSessionID IS NULL AND OwnerToken IS NULL)
       OR (Mode=N'WAIT_CALC' AND PendingCalc=1 AND @Action=N'CALC' AND @CalcProdKey=0
           AND OrderYear=@OrderYear AND OrderWeek=@OrderWeek));
    SET @changed=@@ROWCOUNT;
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER()=1222 RETURN;
    THROW;
  END CATCH;
  IF @changed=1
  BEGIN SET @OwnerToken=@newToken; SET @oResult=0; SET @oMessage=N''; END;
END;
GO

CREATE   PROCEDURE dbo.usp_NenovaStockWeekGateLeave
  @Action nvarchar(20), @Success bit,
  @ProtocolVersion int=NULL, @OwnerToken uniqueidentifier=NULL,
  @oResult int=NULL OUTPUT
AS
BEGIN
  -- NENOVA_STOCK_GATE_OWNER_V2: stale Leave is a zero-row no-op, including after ROLLBACK.
  SET NOCOUNT ON;
  SET @oResult=-98;
  IF ISNULL(@ProtocolVersion,0)<>2 OR @OwnerToken IS NULL OR @Success IS NULL
    OR @Action IS NULL OR @Action NOT IN(N'FIX',N'CANCEL',N'CALC') RETURN;
  DECLARE @pending bit=CASE WHEN (@Action IN(N'FIX',N'CANCEL') AND @Success=1)
    OR (@Action=N'CALC' AND @Success=0) THEN 1 ELSE 0 END;
  UPDATE dbo.NenovaStockWeekGate
     SET Mode=CASE WHEN @pending=1 THEN N'WAIT_CALC' ELSE NULL END,
         LockedAt=CASE WHEN @pending=1 THEN GETDATE() ELSE NULL END,
         Action=CASE WHEN @pending=1 THEN @Action ELSE NULL END,
         OrderYear=CASE WHEN @pending=1 THEN OrderYear ELSE NULL END,
         OrderWeek=CASE WHEN @pending=1 THEN OrderWeek ELSE NULL END,
         OwnerSessionID=CASE WHEN @pending=1 THEN OwnerSessionID ELSE NULL END,
         OwnerToken=CASE WHEN @pending=1 THEN OwnerToken ELSE NULL END,
         PendingCalc=@pending, CalcProdKey=NULL
   WHERE GateKey='1' AND ProtocolVersion=2 AND Mode=N'RUN' AND Action=@Action
     AND OwnerSessionID=@@SPID AND OwnerToken=@OwnerToken;
  SET @oResult=CASE WHEN @@ROWCOUNT=1 THEN 0 ELSE -97 END;
END;
GO

-- =============================================
-- Author:		<우리비엔씨 이청솔>
-- Create date: <2025. 04. 30>
-- Description:	<출고 확정>
-- Result Code :
--  -1: 오류
--   0: OK
--   1:
--   2:
-- =============================================
CREATE PROCEDURE [dbo].[usp_StockCalculation]
	@OrderYear nvarchar(20),
	@OrderWeek nvarchar(20),
	@ProdKey INT,
	@iUserID nvarchar(20),
	@oResult int out,
	@oMessage nvarchar(MAX) out -- 체크 후 결과 값 메세지
AS
BEGIN
	SET NOCOUNT ON;
	set @oResult = 0;
	set @oMessage = '';

	DECLARE @gateRes int, @gateMsg nvarchar(200), @nenovaGateOwnerToken uniqueidentifier; -- NENOVA_STOCK_GATE_OWNER_V2
DECLARE @nenovaGateCalcProdKey int=ISNULL(@ProdKey,0);
	EXEC dbo.usp_NenovaStockWeekGateEnter
		@Action = N'CALC',
		@OrderYear = @OrderYear,
		@OrderWeek = @OrderWeek,
		@oResult = @gateRes OUTPUT,
		@oMessage = @gateMsg OUTPUT, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken OUTPUT, @CalcProdKey = @nenovaGateCalcProdKey;
	IF ISNULL(@gateRes, 0) <> 0
	BEGIN
		SET @oResult = @gateRes;
		SET @oMessage = @gateMsg;
		RETURN;
	END


	BEGIN TRY
        BEGIN TRANSACTION

		IF (@OrderYear <= 2025)
		BEGIN
			set @oMessage = '2026년 이전의 자료는 재고를 수정할 수 없습니다.'; -- 오류 메시지 할당
			EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'CALC', @Success = 0, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;
		return -1;
		END

		-- 변수 설정
		DECLARE @OrderYearWeek nvarchar(20);
		DECLARE @StockKey INT;
		DECLARE @BeforeStockKey INT;

		SET @OrderYearWeek = @orderYear + REPLACE(@orderWeek, '-', '');

		-- 지정한 날짜의 재고Master 가 없다면 Master 생성
		IF((SELECT COUNT(*) FROM StockMaster WHERE OrderYear = @OrderYear AND OrderWeek = @OrderWeek) = 0)
		BEGIN
			INSERT INTO StockMaster (OrderYear, OrderWeek, OrderYearWeek, Descr, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
			VALUES(@OrderYear, @OrderWeek, @OrderYearWeek, '', @iUserID, GETDATE(), @iUserID, GETDATE())
		END

		-- 선택된 Key 포함해서 그뒤에 내역도 가져와서 계산하기 (앞에가 변경되면 뒤도 자동으로 변경)
		SELECT
			sm.OrderYear,
			sm.OrderWeek
		INTO #CalculationList
		FROM StockMaster sm
		WHERE OrderYearWeek >= @OrderYearWeek
	    ORDER BY sm.OrderYear, sm.OrderWeek

		DECLARE list_cursor CURSOR FOR
		SELECT OrderYear, OrderWeek FROM #CalculationList;

		OPEN list_cursor;

		FETCH NEXT FROM list_cursor INTO @OrderYear, @OrderWeek;

		WHILE @@FETCH_STATUS = 0
		BEGIN
			-- 재고 Key 가져오기
			SELECT @StockKey = StockKey
			  FROM StockMaster
			 WHERE OrderYear = @OrderYear
			   AND OrderWeek = @OrderWeek

			SET @OrderYearWeek = @orderYear + REPLACE(@orderWeek, '-', '');

			PRINT 'OrderYear ' + CAST(@OrderYear AS NVARCHAR)
			PRINT 'OrderWeek ' + CAST(@OrderWeek AS NVARCHAR)

			-- 전차수 재고 Key 가져오기
			SELECT TOP 1 @BeforeStockKey = StockKey
			  FROM StockMaster
			WHERE OrderYearWeek < @OrderYearWeek
			 ORDER BY OrderYearWeek desc, OrderWeek desc

			 PRINT 'OrderWeek ' + CAST(@OrderYearWeek AS NVARCHAR)
			 PRINT 'BeforeStockKey ' + CAST(@BeforeStockKey AS NVARCHAR)

			-- 적용할 제품에 대한 목록 가져오기 (CountryFlower가 없다면, 전체)
			SELECT p.ProdKey,
				   ISNULL(ps.Stock, 0) Stock
			INTO #ProductList
			FROM Product p
			LEFT JOIN (
				SELECT ProdKey, Stock
				FROM StockMaster sm
				JOIN ProductStock ps ON sm.StockKey = ps.StockKey
				WHERE sm.StockKey = @BeforeStockKey
			) ps ON p.ProdKey = ps.ProdKey
			WHERE 1 = 1 -- 기본 조건 (항상 참)
			AND p.isDeleted = 0
			AND (
				ISNULL(@ProdKey,0) = 0 OR p.ProdKey = @ProdKey
			);

			-- 입고수량 가져오기
			SELECT vw.ProdKey,
				   ROUND(SUM(vw.OutQuantity),2) OutQuantity
			  INTO #WarehouseList
			  FROM ViewWarehouse vw
			  JOIN   #ProductList pl
				ON vw.ProdKey = pl.ProdKey
			 WHERE vw.OrderYear = @OrderYear
			   AND vw.OrderWeek = @OrderWeek
			 GROUP BY vw.ProdKey

			-- 출고수량 가져오기
			SELECT vs.ProdKey,
				   ROUND(SUM(vs.OutQuantity),2) OutQuantity
			  INTO #ShipmentList
			  FROM ViewShipment vs
			  JOIN   #ProductList pl
				ON vs.ProdKey = pl.ProdKey
			 WHERE vs.OrderYear = @OrderYear
			   AND vs.OrderWeek = @OrderWeek
			   AND vs.DetailFix = 1
			 GROUP BY vs.ProdKey

			-- 재고조정수량 가져오기
			SELECT sh.ProdKey,
				   ROUND(SUM(sh.AfterValue - sh.BeforeValue),2) OutQuantity
			  INTO #StockHistoryList
			  FROM StockHistory sh
			  JOIN   #ProductList pl
				ON sh.ProdKey = pl.ProdKey
			  JOIN CodeInfo ci
			    ON ci.Category = 'StockType'
			   AND sh.ChangeType = ci.Descr
			 WHERE sh.OrderYear = @OrderYear
			   AND sh.OrderWeek = @OrderWeek
			 GROUP BY sh.ProdKey

			-- 이미 있는 제품은 재고를 업데이트
			UPDATE ps
			 SET ps.Stock = ROUND((pl.Stock + ISNULL(wl.OutQuantity,0) - ISNULL(sl.OutQuantity,0) + ISNULL(shl.OutQuantity,0)),2)
			 FROM #ProductList pl
			 JOIN ProductStock ps
			 ON pl.ProdKey = ps.ProdKey
			 JOIN StockMaster sm
			 ON ps.StockKey = sm.StockKey AND sm.OrderYear = @OrderYear AND sm.OrderWeek = @OrderWeek
			 LEFT JOIN #WarehouseList wl
			 on wl.ProdKey = pl.ProdKey
			 LEFT JOIN #ShipmentList sl
			 on sl.ProdKey = pl.ProdKey
			 LEFT JOIN #StockHistoryList shl
			 on shl.ProdKey = pl.ProdKey

			-- 없는 제품은 새로 생성
			INSERT INTO ProductStock (StockKey, ProdKey, Stock)
			SELECT @StockKey, pl.ProdKey,  ROUND((pl.Stock + ISNULL(wl.OutQuantity,0) - ISNULL(sl.OutQuantity,0) + ISNULL(shl.OutQuantity,0)),2) Stock
			 FROM #ProductList pl
			 LEFT JOIN #WarehouseList wl
			 on wl.ProdKey = pl.ProdKey
			 LEFT JOIN #ShipmentList sl
			 on sl.ProdKey = pl.ProdKey
			 LEFT JOIN #StockHistoryList shl
			 on shl.ProdKey = pl.ProdKey
			WHERE NOT EXISTS (SELECT * FROM ProductStock ps JOIN StockMaster sm
			 ON ps.StockKey = sm.StockKey AND sm.OrderYear = @OrderYear AND sm.OrderWeek = @OrderWeek WHERE pl.ProdKey = ps.ProdKey)

			-- Temp 지우기
			DROP TABLE #ProductList;
			DROP TABLE #WarehouseList;
			DROP TABLE #ShipmentList;
			DROP TABLE #StockHistoryList;

			FETCH NEXT FROM list_cursor INTO @OrderYear, @OrderWeek;
		END

		CLOSE list_cursor;
		DEALLOCATE list_cursor;

		-- 트랜잭션 커밋
		IF @@TRANCOUNT > 0
            COMMIT TRANSACTION;

		set @oResult = 0;
		set @oMessage = '확정 완료';
		EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'CALC', @Success = 1, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;
		return 0;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

		set @oResult = -1;
		set @oMessage = ERROR_MESSAGE(); -- 오류 메시지 할당
		EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'CALC', @Success = 0, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;
		return -1;
    END CATCH;

END
