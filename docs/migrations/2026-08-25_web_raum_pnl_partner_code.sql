-- 라움/초이문 손익 거래처 구분(웹 전용). ERP 원장은 변경하지 않는다.
-- 기존 행은 라움으로 본다. 같은 연도·대차수라도 거래처가 다르면 별도 결산이다.
IF OBJECT_ID('dbo.WebRaumPnl', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.WebRaumPnl', 'PartnerCode') IS NULL
BEGIN
  ALTER TABLE dbo.WebRaumPnl ADD PartnerCode NVARCHAR(20) NOT NULL
    CONSTRAINT DF_WebRaumPnl_PartnerCode DEFAULT N'raum';
END;
