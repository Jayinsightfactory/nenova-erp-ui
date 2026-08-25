-- 2026-08-25: ShipmentDetail OutQuantity 로그 트리거 — 웹 SqlClient 감사줄 중단
--
-- 문제:
-- - 웹(mssql/.Net SqlClient)이 OutQuantity를 바꾸면 트리거가
--   [YYYY-MM-DD HH:mm] [.Net SqlClient Data Provider / login] 20->10
--   을 ShipmentDetail.Descr 끝에 append 한다.
-- - nenova.exe 분배 비고에 SQL 드라이버명이 그대로 보인다.
-- - 웹은 이미 "재용3>2" 형식(changeEntry/appendDescr)을 기록한다.
--
-- 조치:
-- - APP_NAME 에 SqlClient / node 가 포함되면 트리거 로그를 남기지 않는다.
-- - Nenova.exe 등 전산 앱만 짧은 수량 변경 한 줄을 남긴다 (APP_NAME/드라이버명 제외).
--
-- Order/Shipment 수량·금액·재고는 변경하지 않는다. Descr 로그만.

IF OBJECT_ID('TR_ShipmentDetail_OutQty_Log', 'TR') IS NOT NULL
  DROP TRIGGER TR_ShipmentDetail_OutQty_Log;
GO

CREATE TRIGGER TR_ShipmentDetail_OutQty_Log
ON ShipmentDetail
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(OutQuantity)
  BEGIN
    -- 웹 Node mssql 드라이버는 APP_NAME=.Net SqlClient Data Provider.
    -- 웹은 lib/shipmentDescr.appendDescr 로 이미 "담당자이전>이후"를 기록한다.
    IF APP_NAME() LIKE N'%SqlClient%'
       OR APP_NAME() LIKE N'%node%'
       OR APP_NAME() LIKE N'%Node%'
      RETURN;

    UPDATE sd
      SET sd.Descr = CASE
            WHEN LTRIM(RTRIM(ISNULL(sd.Descr, N''))) = N'' THEN
              CAST(ISNULL(d.OutQuantity, 0) AS NVARCHAR(40)) + N'>' +
              CAST(ISNULL(i.OutQuantity, 0) AS NVARCHAR(40))
            ELSE
              LEFT(
                LTRIM(RTRIM(ISNULL(sd.Descr, N''))) + N',' +
                CAST(ISNULL(d.OutQuantity, 0) AS NVARCHAR(40)) + N'>' +
                CAST(ISNULL(i.OutQuantity, 0) AS NVARCHAR(40)),
                200
              )
          END
    FROM ShipmentDetail sd
    JOIN inserted i ON sd.SdetailKey = i.SdetailKey
    JOIN deleted  d ON sd.SdetailKey = d.SdetailKey
    WHERE ISNULL(i.OutQuantity, 0) <> ISNULL(d.OutQuantity, 0);
  END
END
GO
