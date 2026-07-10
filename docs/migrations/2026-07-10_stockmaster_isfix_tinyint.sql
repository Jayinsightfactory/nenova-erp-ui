-- StockMaster.isFix: bit -> tinyint
-- 차수피벗의 "시작재고" 저장 기능(pages/api/shipment/stock-status.js saveStartStock)이
-- isFix=2 를 "사용자 시작재고" 전용 마커로 쓰도록 설계돼 있는데, 컬럼이 bit(0/1만 가능)라
-- 2 를 넣으면 SQL Server 가 조용히 1로 바꿔버림 -> "확정(1)"과 "시작재고(2)"가 구분 불가.
-- 게다가 기존 행을 찾는 조건도 isFix=2 라 bit 컬럼에서는 절대 매치되지 않아, 저장할 때마다
-- 기존 행을 덮어쓰지 않고 매번 새 StockMaster 행이 생성됨(15-02/17-01/19-01 주차에 중복 다수 확인).
-- 이 마이그레이션은 컬럼 타입만 넓힌다(bit 값 0/1 은 tinyint 0/1 로 손실 없이 변환됨).
-- 코드 쪽 수정(OrderYear 채우기 + 조회조건에 OrderYear 포함)은 pages/api/shipment/stock-status.js 에서 별도 처리.

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME = 'StockMaster' AND COLUMN_NAME = 'isFix' AND DATA_TYPE = 'bit'
)
BEGIN
  ALTER TABLE dbo.StockMaster ALTER COLUMN isFix TINYINT NULL;
END
GO
