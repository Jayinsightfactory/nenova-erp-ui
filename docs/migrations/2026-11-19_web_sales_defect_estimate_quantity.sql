-- Run before deploying code that writes the separate quote quantity.
-- NULL keeps historical and imported claims on their original quantity fallback.
IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'EstimateQuantity') IS NULL
  ALTER TABLE dbo.WebSalesDefectDeduction ADD EstimateQuantity DECIMAL(18,4) NULL
    CONSTRAINT CK_WebSalesDefectDeduction_EstimateQuantity_Positive CHECK (EstimateQuantity > 0);
