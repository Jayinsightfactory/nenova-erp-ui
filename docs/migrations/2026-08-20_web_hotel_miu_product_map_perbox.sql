-- 호텔+미우 확인표 박스당 계수 overlay.
-- Product 마스터는 바꾸지 않는다. InputToken = prodbox:{ProdKey}

IF COL_LENGTH(N'dbo.WebHotelMiuProductMap', N'PerBox') IS NULL
  ALTER TABLE dbo.WebHotelMiuProductMap ADD PerBox FLOAT NULL;
