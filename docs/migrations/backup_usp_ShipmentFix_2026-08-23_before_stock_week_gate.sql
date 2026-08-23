
-- 2026-08-20: usp_ShipmentFix 잔량 검사만 변경.
-- 당주차 ProductStock(ns.Stock)은 leftover(확정출고만 차감)라서
-- 확정취소 후 재계산이 빠지면 미확정 출고를 한 번 더 빼 이중차감이 된다.
-- 검사식을 usp_StockCalculation leftover − 이번 미확정 출고로 맞춘다.
-- @oMessage 문구는 nenova.exe UI 호환을 위해 유지한다.
-- 이 스크립트는 운영 MSSQL의 ALTER PROCEDURE 이다. 웹 배포와 별개로 적용한다.

CREATE PROCEDURE [dbo].[usp_ShipmentFix]
	@OrderYear nvarchar(20), 
	@OrderWeek nvarchar(20), 
	@CountryFlower nvarchar(100), 
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

		-- 변수 설정
		DECLARE @CheckCnt INT;
		DECLARE @BaseOutDay INT;
		DECLARE @OrderYearWeek nvarchar(20);
		DECLARE @BeforeStockKey INT;

		-- 포함되는 출고 내역 다 가져오기
	    SELECT vs.ProdKey,
               vs.ShipmentKey,
			   vs.OrderYearWeek2,
               vs.SdetailKey,
               vs.OutQuantity,
               vs.DetailFix isFix
		 INTO #ShipmentList
		 FROM ViewShipment vs
		WHERE vs.OrderYear = @OrderYear and vs.OrderWeek = @OrderWeek AND vs.CountryFlower = @CountryFlower
		 AND ISNULL(vs.DetailFix,0) = 0

		--select * from #ShipmentList

		---- 출고 내역 데이터에서 잔량이 마이너스 인 항목이 있는지 가져오기
		-- leftover = 직전 StockMaster 스냅샷 + 현차수 입고 − 확정출고(DetailFix=1) + StockType 조정
		-- 확정 가능 잔량 = leftover − 이번 미확정 출고. ROUND(...,0) < 0 이면 차단.
		SET @CheckCnt = 0;
		SET @OrderYearWeek = @OrderYear + REPLACE(@OrderWeek, '-', '');
		SELECT TOP 1 @BeforeStockKey = StockKey
		  FROM StockMaster
		 WHERE OrderYearWeek < @OrderYearWeek
		 ORDER BY OrderYearWeek DESC, OrderWeek DESC;

		SELECT @CheckCnt = COUNT(*)
		  FROM (
		        SELECT ProdKey, SUM(OutQuantity) OutQuantity
		          FROM #ShipmentList
		         GROUP BY ProdKey
		       ) sl
		  LEFT JOIN (
		        SELECT ps.ProdKey, ISNULL(ps.Stock, 0) Stock
		          FROM StockMaster sm
		          JOIN ProductStock ps ON sm.StockKey = ps.StockKey
		         WHERE sm.StockKey = @BeforeStockKey
		       ) prev ON prev.ProdKey = sl.ProdKey
		  LEFT JOIN (
		        SELECT ProdKey, ROUND(SUM(OutQuantity), 2) qty
		          FROM ViewWarehouse
		         WHERE OrderYear = @OrderYear AND OrderWeek = @OrderWeek
		         GROUP BY ProdKey
		       ) wr ON wr.ProdKey = sl.ProdKey
		  LEFT JOIN (
		        SELECT ProdKey, ROUND(SUM(OutQuantity), 2) qty
		          FROM ViewShipment
		         WHERE OrderYear = @OrderYear AND OrderWeek = @OrderWeek
		           AND DetailFix = 1
		         GROUP BY ProdKey
		       ) cf ON cf.ProdKey = sl.ProdKey
		  LEFT JOIN (
		        SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue - sh.BeforeValue), 2) qty
		          FROM StockHistory sh
		          JOIN CodeInfo ci ON ci.Category = 'StockType' AND sh.ChangeType = ci.Descr
		         WHERE sh.OrderYear = @OrderYear AND sh.OrderWeek = @OrderWeek
		         GROUP BY sh.ProdKey
		       ) adj ON adj.ProdKey = sl.ProdKey
		 WHERE ROUND((
		        ISNULL(prev.Stock, 0)
		        + ISNULL(wr.qty, 0)
		        - ISNULL(cf.qty, 0)
		        + ISNULL(adj.qty, 0)
		        - ISNULL(sl.OutQuantity, 0)
		       ), 0) < 0

		IF(@CheckCnt > 0)
		BEGIN
			IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

			SET @oResult = -1;
			SET @oMessage = '제품 잔량이 마이너스인 출고 정보가 존재합니다.';
			RETURN -1;
		END

		-- 출고 수량과, 출고일 지정 수량이 동일한지 체크하기
		SET @CheckCnt = 0;
		SELECT @CheckCnt = COUNT(*)
		  FROM #ShipmentList sl
		  JOIN (SELECT SdetailKey, SUM(ShipmentQuantity) ShipmentQuantity FROM ShipmentDate GROUP BY SdetailKey) sd
		    ON sl.SdetailKey = sd.SdetailKey 
		 WHERE sl.OutQuantity != sd.ShipmentQuantity

		IF(@CheckCnt > 0)
		BEGIN
			IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

			SET @oResult = -1;
			SET @oMessage = '출고수량과 출고일 지정 수량이 다른 항목이 존재합니다.';
			RETURN -1;
		END

		-- Temp 먼저확정
		UPDATE sl
		   SET isFix = 1
		  FROM #ShipmentList sl
		WHERE SdetailKey > 0

		-- 없다면 확정하기
		UPDATE sd
		   SET isFix = sl.isFix
		  FROM #ShipmentList sl
		  JOIN ShipmentDetail sd
		    ON sl.SdetailKey = sd.SdetailKey 

		-- Detail 항목이 다 Fix되었다면 Master도 Fix 시켜주기
	    UPDATE sl
		   SET isFix = CASE WHEN sd.FixCnt > 1 THEN 0 ELSE 1 END
		  FROM ShipmentMaster sl
	      JOIN ( SELECT ShipmentKey, SUM(CASE WHEN ISNULL(isFix,0) = 0 THEN 1 ELSE 0 END) FixCnt
	   			   FROM #ShipmentList GROUP BY ShipmentKey) sd
	   	    ON sl.ShipmentKey = sd.ShipmentKey 

		-- 재고 히스토리 생성 
		INSERT INTO StockHistory (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
		SELECT
			GETDATE() ChangeDtm, 
			@OrderYear,
			@OrderWeek,
			@iUserID ChangeID,
			'출고' ChangeType,
			'수량' ColumnName,
			p.Stock BeforeValue,
			(p.Stock - sl.OutQuantity) AfterValue,
			'출고확정' Descr,
			p.ProdKey
		FROM Product p
		JOIN (SELECT ProdKey, SUM(OutQuantity) OutQuantity FROM  #ShipmentList GROUP BY ProdKey) sl 
		  ON p.ProdKey = sl.ProdKey 

		-- 재고 적용
		UPDATE p
		 SET p.Stock = (p.Stock - sl.OutQuantity) 
		FROM Product p
		JOIN (SELECT ProdKey, SUM(OutQuantity) OutQuantity FROM  #ShipmentList GROUP BY ProdKey) sl 
		  ON p.ProdKey = sl.ProdKey 

		-- 현재 출고일 리스트 가져오기
		SELECT
			sd.SdetailKey,
			sdt.ShipmentDtm,
			sdt.ShipmentQuantity
		INTO #CurrentShipmentDates
		FROM #ShipmentList sd
		JOIN ShipmentDate sdt ON sd.SdetailKey = sdt.SdetailKey

		-- 이전 출고일 관련 히스토리 가져오기
		SELECT
			sh.SdetailKey,
			sh.ShipmentDtm,
			sh.AfterValue
		INTO #PreviousShipmentDates
		FROM (
			SELECT
				sh.SdetailKey,
				sh.ShipmentDtm,
				sh.AfterValue,
				ROW_NUMBER() OVER(PARTITION BY sh.SdetailKey, sh.ShipmentDtm ORDER BY sh.ChangeDtm DESC) AS rn
			FROM ShipmentHistory sh
			WHERE EXISTS (SELECT 1 FROM #ShipmentList WHERE SdetailKey = sh.SdetailKey)
		) AS sh
		WHERE rn = 1;

		-- 신규 추가된 출고일 기록
		INSERT INTO ShipmentHistory (ChangeDtm, ChangeID, ChangeType, ShipmentDtm, BeforeValue, AfterValue, Descr, SdetailKey)
		SELECT
			GETDATE(),
			@iUserID,
			'신규',
			csd.ShipmentDtm,
			0,
			csd.ShipmentQuantity,
			'',
			csd.SdetailKey
		FROM #CurrentShipmentDates csd
		WHERE NOT EXISTS (SELECT 1 FROM #PreviousShipmentDates psd
						   WHERE psd.SdetailKey = csd.SdetailKey
							 AND psd.ShipmentDtm = csd.ShipmentDtm);

		-- 삭제된 출고일 기록
		INSERT INTO ShipmentHistory (ChangeDtm, ChangeID, ChangeType, ShipmentDtm, BeforeValue, AfterValue, Descr, SdetailKey)
		SELECT
			GETDATE(),
			@iUserID,
			'삭제',
			psd.ShipmentDtm,
			psd.AfterValue,
			0,
			'',
			psd.SdetailKey
		FROM #PreviousShipmentDates psd
		WHERE NOT EXISTS (SELECT 1 FROM #CurrentShipmentDates csd
						   WHERE csd.SdetailKey = psd.SdetailKey
							 AND csd.ShipmentDtm = psd.ShipmentDtm);

		-- 기존 출고일 수량 변경 이력 기록 
		INSERT INTO ShipmentHistory (ChangeDtm, ChangeID, ChangeType, ShipmentDtm, BeforeValue, AfterValue, Descr, SdetailKey)
		SELECT
			GETDATE(),
			@iUserID,
			'수정',
			csd.ShipmentDtm,
			psd.AfterValue,
			csd.ShipmentQuantity,
			'',
			csd.SdetailKey
		FROM #CurrentShipmentDates csd
		JOIN #PreviousShipmentDates psd 
		ON csd.SdetailKey = psd.SdetailKey AND csd.ShipmentDtm = psd.ShipmentDtm AND csd.ShipmentQuantity != psd.AfterValue
		
		-- 임시 테이블 삭제
		DROP TABLE #CurrentShipmentDates;
		DROP TABLE #PreviousShipmentDates;
		DROP TABLE #ShipmentList;

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

