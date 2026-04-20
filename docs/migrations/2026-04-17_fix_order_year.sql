-- 구형식 차수(WW-SS, 2025년 데이터)인데 OrderYear='2026'으로 잘못 저장된 건 수정
-- 실행 전 SELECT로 확인 후 UPDATE 실행

-- 확인용
SELECT OrderMasterKey, CustKey, OrderWeek, OrderYear, OrderDtm
FROM OrderMaster
WHERE OrderWeek NOT LIKE '%-%-%'   -- WW-SS 형식 (4글자 미만 → 구형식)
  AND LEN(OrderWeek) = 5           -- '16-01' 같은 5자리
  AND OrderYear = '2026'
  AND isDeleted = 0;

-- 수정
UPDATE OrderMaster
SET OrderYear = '2025'
WHERE OrderWeek NOT LIKE '____-%'  -- YYYY- 로 시작하지 않는 것
  AND LEN(OrderWeek) = 5           -- 'WW-SS' 5자리
  AND OrderYear = '2026'
  AND isDeleted = 0;
