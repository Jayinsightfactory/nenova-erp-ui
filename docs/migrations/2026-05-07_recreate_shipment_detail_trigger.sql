-- 2026-05-07: ShipmentDetail.OutQuantity 변경 자동 로그 트리거 복구
--
-- 배경:
-- - 2026-04-17 에 한 번 만들었던 TR_ShipmentDetail_OutQty_Log 가 DB 에서 사라진 상태
--   (sp_helptext 'TR_ShipmentDetail_OutQty_Log' → 'object does not exist')
-- - 차수피벗 화면의 비고(Descr) 컬럼이 자동 누적 안 됨
--
-- 효과:
-- - 누가(웹/Nenova.exe) 출고수량 수정하든 트리거가 자동으로 Descr 끝에 한 줄 append
--   예: [2026-05-07 16:50] [Nenova.exe / nenovaSS3] 100→90
-- - 차수피벗 화면 새로고침 시 즉시 반영 (DB 레벨이라 양쪽 도구 모두 자동 적용)
--
-- 라벨 개선 (이전 버전 [전산수정] 고정 → 출처 자동 구분):
-- - APP_NAME(): 접속 애플리케이션 이름. Nenova.exe / .Net SqlClient / Node.js 구분 가능
-- - SUSER_SNAME(): DB 접속 SQL 로그인 ID
--
-- 실행 방법: SSMS 에서 1회 실행. 이미 있으면 DROP 후 재생성.

IF OBJECT_ID('TR_ShipmentDetail_OutQty_Log', 'TR') IS NOT NULL
  DROP TRIGGER TR_ShipmentDetail_OutQty_Log;
GO

CREATE TRIGGER TR_ShipmentDetail_OutQty_Log
ON ShipmentDetail
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  -- OutQuantity 컬럼이 UPDATE 대상에 포함된 경우만 작동 (재귀 방지)
  IF UPDATE(OutQuantity)
  BEGIN
    UPDATE sd
      SET sd.Descr = ISNULL(sd.Descr,'') +
        CHAR(13) + CHAR(10) +
        '[' + CONVERT(NVARCHAR(16), GETDATE(), 120) + '] ' +
        '[' + ISNULL(APP_NAME(), 'unknown') + ' / ' + ISNULL(SUSER_SNAME(), 'unknown') + '] ' +
        CAST(ISNULL(d.OutQuantity, 0) AS NVARCHAR) + '→' +
        CAST(ISNULL(i.OutQuantity, 0) AS NVARCHAR)
    FROM ShipmentDetail sd
    JOIN inserted i ON sd.SdetailKey = i.SdetailKey
    JOIN deleted  d ON sd.SdetailKey = d.SdetailKey
    WHERE ISNULL(i.OutQuantity, 0) <> ISNULL(d.OutQuantity, 0);
  END
END
GO

-- 검증 SQL (위 CREATE 후 실행)
-- 1. 트리거 존재 확인
SELECT name, is_disabled, create_date, modify_date
FROM sys.triggers
WHERE name = 'TR_ShipmentDetail_OutQty_Log';

-- 2. 트리거 정의 확인
EXEC sp_helptext 'TR_ShipmentDetail_OutQty_Log';

-- 3. 테스트 — 임의의 ShipmentDetail 한 줄 OutQuantity 변경해보고 Descr 확인
-- (실제 데이터 건드리지 말고 결과만 확인 후 ROLLBACK)
/*
BEGIN TRAN;
DECLARE @testKey INT = (SELECT TOP 1 SdetailKey FROM ShipmentDetail WHERE OutQuantity > 0);
SELECT 'BEFORE' AS phase, SdetailKey, OutQuantity, Descr FROM ShipmentDetail WHERE SdetailKey = @testKey;

UPDATE ShipmentDetail SET OutQuantity = OutQuantity + 0.001 WHERE SdetailKey = @testKey;
SELECT 'AFTER' AS phase, SdetailKey, OutQuantity, Descr FROM ShipmentDetail WHERE SdetailKey = @testKey;

ROLLBACK;
*/
