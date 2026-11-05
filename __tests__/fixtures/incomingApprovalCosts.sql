-- Actual operating column types observed 2026-11-04; isolated test only.
IF DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]approval[_]%' THROW 51000,'isolated cost fixture only',1;
GO
IF OBJECT_ID(N'dbo.FreightCost') IS NOT NULL DROP TABLE dbo.FreightCost;
CREATE TABLE dbo.FreightCost(
 [FreightKey] int IDENTITY(1,1) PRIMARY KEY NOT NULL,
 [WarehouseKey] int NOT NULL,
 [WeightBasis] nvarchar(10) NOT NULL,
 [ExchangeRate] decimal(10,4) NOT NULL,
 [GrossWeight] decimal(10,2) NOT NULL,
 [ChargeableWeight] decimal(10,2) NOT NULL,
 [FreightRateUSD] decimal(10,4) NOT NULL,
 [DocFeeUSD] decimal(10,2) NOT NULL,
 [InvoiceTotalUSD] decimal(14,2) NULL,
 [BakSangRate] decimal(10,2) NOT NULL,
 [HandlingFee] decimal(14,2) NOT NULL,
 [QuarantinePerItem] decimal(14,2) NOT NULL,
 [DomesticFreight] decimal(14,2) NOT NULL,
 [DeductFee] decimal(14,2) NOT NULL,
 [ExtraFee] decimal(14,2) NOT NULL,
 [CreateID] nvarchar(50) NULL,
 [CreateDtm] datetime NULL DEFAULT (getdate()),
 [UpdateID] nvarchar(50) NULL,
 [UpdateDtm] datetime NULL,
 [isDeleted] bit NOT NULL DEFAULT ((0))
);
GO
IF OBJECT_ID(N'dbo.FreightCostDetail') IS NOT NULL DROP TABLE dbo.FreightCostDetail;
CREATE TABLE dbo.FreightCostDetail(
 [DetailKey] int IDENTITY(1,1) PRIMARY KEY NOT NULL,
 [FreightKey] int NOT NULL,
 [WarehouseDetailKey] int NULL,
 [ProdKey] int NOT NULL,
 [ProdName] nvarchar(200) NULL,
 [FlowerName] nvarchar(100) NULL,
 [FarmName] nvarchar(100) NULL,
 [SteamQty] decimal(14,2) NULL,
 [FOBUSD] decimal(10,4) NULL,
 [BoxQty] decimal(10,2) NULL,
 [BoxWeightUsed] decimal(10,3) NULL,
 [BoxCBMUsed] decimal(10,3) NULL,
 [StemsPerBoxUsed] decimal(10,2) NULL,
 [StemsPerBunch] decimal(10,2) NULL,
 [SalePriceKRW] decimal(14,2) NULL,
 [TariffRate] decimal(10,4) NULL,
 [FreightPerStemUSD] decimal(10,6) NULL,
 [CNF_USD] decimal(10,6) NULL,
 [CNF_KRW] decimal(14,4) NULL,
 [TariffKRW] decimal(14,2) NULL,
 [CustomsPerStem] decimal(14,4) NULL,
 [ArrivalPerStem] decimal(14,4) NULL,
 [ArrivalPerBunch] decimal(14,2) NULL,
 [SalePriceExVAT] decimal(14,2) NULL,
 [ProfitPerBunch] decimal(14,2) NULL,
 [ProfitRate] decimal(10,6) NULL,
 [TotalSaleKRW] decimal(14,2) NULL,
 [TotalProfitKRW] decimal(14,2) NULL,
 [SortOrder] int NULL
);
GO
