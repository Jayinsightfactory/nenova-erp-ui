-- 2026-04-17: ShipmentDetail 출고수량 변경 시 Descr에 자동 로그 기록
-- SSMS에서 1회 실행

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
    UPDATE sd
      SET sd.Descr = ISNULL(sd.Descr,'') +
        CHAR(10) + '[' + CONVERT(NVARCHAR(16), GETDATE(), 120) + '] [전산수정] ' +
        CAST(ISNULL(d.OutQuantity,0) AS NVARCHAR) + '→' +
        CAST(ISNULL(i.OutQuantity,0) AS NVARCHAR)
    FROM ShipmentDetail sd
    JOIN inserted i ON sd.SdetailKey = i.SdetailKey
    JOIN deleted  d ON sd.SdetailKey = d.SdetailKey
    WHERE ISNULL(i.OutQuantity,0) <> ISNULL(d.OutQuantity,0);
  END
END
GO
