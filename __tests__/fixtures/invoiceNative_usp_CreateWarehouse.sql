
-- =============================================
-- Author:		<우리비엔씨 이청솔>
-- Create date: <2025. 03. 29>
-- Description:	<TempWarehouseDetail -> WarehouseDetail 데이터 생성>
-- Result Code : 
--  -1: 오류
--   0: OK
--   1: 
--   2: 
-- =============================================
--exec usp_CreateWarehouse @iUserID = N'admin',@oResult = 0
CREATE PROCEDURE [dbo].[usp_CreateWarehouse]
	@iUserID nvarchar(20), 
	@oResult int out
AS
BEGIN
	SET NOCOUNT ON;
	set @oResult = 0;

	BEGIN TRY
        BEGIN TRANSACTION

		-- 필요한 데이터 Temp에 넣기 
		UPDATE td
		   SET td.ProdKey = p.ProdKey,
			   td.OutQuantity = CASE
									WHEN p.OutUnit = '박스' THEN td.BoxQuantity
									WHEN p.OutUnit = '단' THEN td.BunchQuantity
									ELSE td.SteamQuantity
								END,
			   td.EstQuantity = CASE
									WHEN p.EstUnit = '박스' THEN td.BoxQuantity
									WHEN p.EstUnit = '단' THEN td.BunchQuantity
									ELSE td.SteamQuantity
								END
		  FROM TempWarehouseDetail td
			   JOIN Product p
				 ON LOWER(REPLACE(LTRIM(RTRIM(td.ProdName)), NCHAR(160), N' '))  = LOWER(REPLACE(LTRIM(RTRIM(p.ProdName)),  NCHAR(160), N' '))
		WHERE p.isDeleted = 0

		-- Detail 생성
		INSERT INTO [dbo].[WarehouseDetail]
			   ([ProdKey]
			   ,[OrderCode]
			   ,[BoxQuantity]
			   ,[BunchQuantity]
			   ,[SteamQuantity]
			   ,[SteamOf1Box]
			   ,[SteamOf1Bunch]
			   ,[OutQuantity]
			   ,[EstQuantity]
			   ,[UPrice]
			   ,[TPrice]
			   ,[WarehouseKey])
	    SELECT ProdKey,
			   OrderCode,
	  		   BoxQuantity,
	  		   BunchQuantity,
	  		   SteamQuantity,
			   SteamOf1Box,
			   SteamOf1Bunch,
	  		   OutQuantity,
	  		   EstQuantity,
	  		   UPrice,
	  		   TPrice,
			   WarehouseKey
	  	  FROM TempWarehouseDetail

		-- 히스토리 생성
		INSERT INTO StockHistory
		(
		  [ChangeDtm],
		  [OrderYear],
		  [OrderWeek],
		  [ChangeID],
		  [ChangeType],
		  [ColumName],
		  [BeforeValue],
		  [AfterValue],
		  [Descr],
		  [ProdKey]
		)
		  SELECT GETDATE(),
				 OrderYear,
				 OrderWeek,
				 @iUserID,
				 '입고',
				 '수량',
				 ISNULL(p.Stock,0),
				 (ISNULL(p.Stock,0) + td.OutQuantity),
				 '파킹리스트 업로드',
				 p.ProdKey
			FROM Product p
			JOIN   ( SELECT tw.ProdKey,
							wm.OrderYear,
							wm.OrderWeek,
							SUM(OutQuantity) OutQuantity
					   FROM TempWarehouseDetail tw
					   JOIN   WarehouseMaster wm
						 ON tw.WarehouseKey = wm.WarehouseKey
					  GROUP BY ProdKey,
							   wm.OrderYear,
							   wm.OrderWeek ) td
			  ON p.ProdKey = td.ProdKey 


		-- 재고 변경
		UPDATE p
		   SET p.Stock = (ISNULL(p.Stock,0) + td.OutQuantity)
		  FROM Product p
		  JOIN (select ProdKey, sum(OutQuantity) OutQuantity from TempWarehouseDetail group by ProdKey) td
			ON p.ProdKey = td.ProdKey 

        if @@TRANCOUNT > 0
			COMMIT TRANSACTION;
		
		set @oResult = 0;
		return 0;
    END TRY
    BEGIN CATCH
        if @@TRANCOUNT > 0
			ROLLBACK TRANSACTION;

		set @oResult = -1;
		return -1;
    END CATCH;

END

