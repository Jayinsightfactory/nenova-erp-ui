
-- =============================================
-- Author:		<우리비엔씨 이청솔>
-- Create date: <2025. 05. 02>
-- Description:	<출고 확정 취소>
-- Result Code : 
--  -1: 오류
--   0: OK
--   1: 
--   2: 
-- =============================================
CREATE PROCEDURE [dbo].[usp_ShipmentFixCancel]
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

		-- 포함되는 출고 내역 다 가져오기
		SELECT vs.ShipmentKey,
		  	   vs.ProdKey,
		  	   vs.SdetailKey,
		  	   vs.OutQuantity
		  INTO #ShipmentList
		  FROM ViewShipment vs
		 WHERE vs.OrderYear = @OrderYear and vs.OrderWeek = @OrderWeek AND vs.CountryFlower = @CountryFlower
		  AND ISNULL(vs.DetailFix,0) = 1

		-- 확정 취소하기
		UPDATE sd
		   SET isFix = 0
		  FROM #ShipmentList sl
		  JOIN ShipmentDetail sd
		    ON sl.SdetailKey = sd.SdetailKey 

		-- Master도 확정 취소하기 
	    UPDATE sl
		   SET isFix = 0
		  FROM ShipmentMaster sl
	      JOIN #ShipmentList sd
	   	    ON sl.ShipmentKey = sd.ShipmentKey 
		
		-- 재고 히스토리 생성 
		INSERT INTO StockHistory (ChangeDtm, ChangeID, OrderYear, OrderWeek, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
		SELECT
			GETDATE() ChangeDtm, 
			@iUserID ChangeID,
			@OrderYear, 
			@OrderWeek,
			'출고' ChangeType,
			'수량' ColumnName,
			p.Stock BeforeValue,
			(p.Stock + sl.OutQuantity) AfterValue,
			'출고확정 취소' Descr,
			p.ProdKey
		FROM Product p
		JOIN (SELECT ProdKey, SUM(OutQuantity) OutQuantity FROM  #ShipmentList GROUP BY ProdKey) sl 
		  ON p.ProdKey = sl.ProdKey 

		-- 재고 적용
		UPDATE p
		 SET p.Stock = (p.Stock + sl.OutQuantity) 
		FROM Product p
		JOIN (SELECT ProdKey, SUM(OutQuantity) OutQuantity FROM  #ShipmentList GROUP BY ProdKey) sl 
		  ON p.ProdKey = sl.ProdKey 
		
		-- 임시 테이블 삭제
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

