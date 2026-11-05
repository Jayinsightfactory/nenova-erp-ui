IF DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]approval[_]%'
 THROW 51000,'isolated approval fixture only',1;
GO
ALTER TABLE Farm ADD FarmCode nvarchar(20) NULL;
ALTER TABLE Product ADD BoxWeight float NULL,BoxCBM float NULL,TariffRate float NULL;
DROP TABLE WebProfitReportConfirm;
GO
