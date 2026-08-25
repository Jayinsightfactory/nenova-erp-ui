/* 선출고 관리 수기 품목·전산 품목 매칭(웹 전용) */
IF COL_LENGTH(N'dbo.WebPreShipmentItem', N'ProdKey') IS NULL
  ALTER TABLE dbo.WebPreShipmentItem ADD ProdKey INT NULL;

IF COL_LENGTH(N'dbo.WebPreShipmentItem', N'MatchedProdName') IS NULL
  ALTER TABLE dbo.WebPreShipmentItem ADD MatchedProdName NVARCHAR(250) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebPreShipmentItem') AND name=N'IX_WebPreShipmentItem_PlanProd')
  CREATE INDEX IX_WebPreShipmentItem_PlanProd ON dbo.WebPreShipmentItem(PlanKey, ProdKey);
