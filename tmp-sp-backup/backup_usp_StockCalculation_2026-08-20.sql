
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

	BEGIN TRY
        BEGIN TRANSACTION

		IF (@OrderYear <= 2025)
		BEGIN
			set @oMessage = '2026년 이전의 자료는 재고를 수정할 수 없습니다.'; -- 오류 메시지 할당
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
		return 0;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

		set @oResult = -1;
		set @oMessage = ERROR_MESSAGE(); -- 오류 메시지 할당
		return -1;
    END CATCH;

END

