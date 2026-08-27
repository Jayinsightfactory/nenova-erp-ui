/*
  Nenova.exe FormStockAdd decimal.Parse(Product.Stock.ToString()) 보호.

  배경:
  - Product.Stock은 float라 출고 확정/취소의 상쇄 계산 뒤 0 대신
    1.776356839400251E-15 같은 극미세값이 남을 수 있다.
  - FormStockAdd는 이 값을 과학적 표기 문자열로 만든 뒤 decimal.Parse하여
    FormatException("입력 문자열의 형식이 잘못되었습니다")을 발생시킨다.

  영향 범위:
  - ProdKey=436(CARNATION Maruchi)의 현재 live Product.Stock 극미세값만 0으로 정리한다.
  - 이후 어떤 저장 경로가 Product.Stock에 절댓값 0.000001 미만의 0이 아닌 값을
    기록하더라도 AFTER 트리거가 정확한 0으로 정규화한다.
  - ProductStock, StockHistory, 주문, 분배, 견적, 매출 원장은 변경하지 않는다.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.Product', N'U') IS NULL
    THROW 51000, N'Product 테이블을 찾을 수 없습니다.', 1;

IF COL_LENGTH(N'dbo.Product', N'Stock') IS NULL
    THROW 51000, N'Product.Stock 열을 찾을 수 없습니다.', 1;

IF EXISTS (
    SELECT 1
    FROM dbo.Product
    WHERE ProdKey = 436
      AND ISNULL(isDeleted, 0) = 0
      AND Stock IS NOT NULL
      AND Stock <> 0
      AND ABS(Stock) >= 0.000001
)
    THROW 51000, N'CARNATION Maruchi 재고가 극미세값 범위를 벗어났습니다. 자동으로 0 처리하지 않습니다.', 1;

EXEC(N'
CREATE OR ALTER TRIGGER dbo.trg_Product_NormalizeTinyStock
ON dbo.Product
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF TRIGGER_NESTLEVEL() > 1 OR NOT UPDATE(Stock)
        RETURN;

    UPDATE p
       SET p.Stock = 0
      FROM dbo.Product AS p
      JOIN inserted AS i ON i.ProdKey = p.ProdKey
     WHERE i.Stock IS NOT NULL
       AND i.Stock <> 0
       AND ABS(i.Stock) < 0.000001;
END;
');

UPDATE dbo.Product
   SET Stock = 0
 WHERE ProdKey = 436
   AND ISNULL(isDeleted, 0) = 0
   AND Stock IS NOT NULL
   AND Stock <> 0
   AND ABS(Stock) < 0.000001;

IF EXISTS (
    SELECT 1
    FROM dbo.Product
    WHERE ProdKey = 436
      AND ISNULL(isDeleted, 0) = 0
      AND Stock <> 0
      AND ABS(Stock) < 0.000001
)
    THROW 51000, N'CARNATION Maruchi 극미세 재고 정규화에 실패했습니다.', 1;

COMMIT TRANSACTION;

