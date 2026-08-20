-- 호텔+미우 주문등록 스냅샷: 반올림 전 합산 수량 vs 실제 주문수량
-- Order/Shipment 원장은 만들지 않는다.

IF OBJECT_ID(N'dbo.WebHotelMiuRegisterSnap', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebHotelMiuRegisterSnap (
    SnapKey INT IDENTITY(1,1) PRIMARY KEY,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    CustKey INT NOT NULL,
    Payload NVARCHAR(MAX) NOT NULL,
    CreatedBy NVARCHAR(50) NULL,
    CreatedAt DATETIME NOT NULL CONSTRAINT DF_WebHotelMiuRegisterSnap_CreatedAt DEFAULT GETDATE(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebHotelMiuRegisterSnap_Deleted DEFAULT 0
  );
END;
