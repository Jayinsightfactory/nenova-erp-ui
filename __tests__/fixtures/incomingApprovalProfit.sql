-- Actual schema types/defaults + actual View definitions, SELECT-only captured 2026-11-04. No operating rows.
IF DB_NAME() NOT LIKE N'NenovaInvoiceFixture[_]profit[_]%' THROW 51000,'isolated profit fixture only',1;
GO
CREATE TABLE dbo.[CodeInfo] (
  [Category] nvarchar(100) NOT NULL,
  [DetailCode] nvarchar(100) NOT NULL,
  [Descr] nvarchar(100) NULL,
  [OrderNo] int NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [Descr2] nvarchar(100) NULL
);
GO
CREATE TABLE dbo.[Country] (
  [CounKey] int IDENTITY(1,1) NOT NULL,
  [CounName] nvarchar(100) NULL,
  [OrderNo] int NULL,
  [isSelectFlower] bit NULL,
  [isUseOrderCode] bit NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [Sort] int NULL
);
GO
CREATE TABLE dbo.[CurrencyMaster] (
  [CurrencyCode] nvarchar(10) NOT NULL,
  [CurrencyName] nvarchar(50) NULL,
  [ExchangeRate] decimal(10,4) NULL DEFAULT ((0)),
  [UpdateDtm] nvarchar(20) NULL,
  [IsActive] bit NULL DEFAULT ((1))
);
GO
CREATE TABLE dbo.[Customer] (
  [CustKey] int IDENTITY(1,1) NOT NULL,
  [CustCode] nvarchar(100) NULL,
  [CustName] nvarchar(100) NULL,
  [CEO] nvarchar(50) NULL,
  [Group1] nvarchar(50) NULL,
  [CustArea] nvarchar(50) NULL,
  [BusinessNumber] nvarchar(20) NULL,
  [Manager] nvarchar(50) NULL,
  [ProductType] nvarchar(20) NULL,
  [Tel] nvarchar(50) NULL,
  [Mobile] nvarchar(50) NULL,
  [SearchComment] nvarchar(200) NULL,
  [UseType] nvarchar(10) NULL,
  [TransType] nvarchar(10) NULL,
  [BaseOutDay] int NULL,
  [OrderCode] nvarchar(20) NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[Estimate] (
  [EstimateKey] int IDENTITY(1,1) NOT NULL,
  [EstimateType] nvarchar(30) NULL,
  [ProdKey] int NULL,
  [Unit] nvarchar(10) NULL,
  [Quantity] float NULL,
  [Cost] float NULL,
  [Amount] float NULL,
  [Vat] float NULL,
  [Descr] nvarchar(200) NULL,
  [ShipmentKey] int NOT NULL,
  [EstimateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[Farm] (
  [FarmKey] int IDENTITY(1,1) NOT NULL,
  [FarmCode] nvarchar(20) NULL,
  [FarmName] nvarchar(100) NULL,
  [CounKey] int NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[Flower] (
  [FlowerKey] int IDENTITY(1,1) NOT NULL,
  [FlowerName] nvarchar(100) NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [Sort] int NULL,
  [OrderNo] int NULL,
  [BoxWeight] decimal(10,3) NULL,
  [BoxCBM] decimal(10,3) NULL,
  [StemsPerBox] decimal(10,2) NULL,
  [DefaultTariff] decimal(10,4) NULL
);
GO
CREATE TABLE dbo.[FreightCost] (
  [FreightKey] int IDENTITY(1,1) NOT NULL,
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
CREATE TABLE dbo.[FreightCostDetail] (
  [DetailKey] int IDENTITY(1,1) NOT NULL,
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
CREATE TABLE dbo.[OrderDetail] (
  [OrderDetailKey] int NOT NULL,
  [ProdKey] int NULL,
  [Descr] nvarchar(200) NULL,
  [BoxQuantity] float NULL,
  [BunchQuantity] float NULL,
  [SteamQuantity] float NULL,
  [OutQuantity] float NULL,
  [EstQuantity] float NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [OrderMasterKey] int NOT NULL,
  [NoneOutQuantity] float NULL,
  [isDeleted] bit NULL
);
GO
CREATE TABLE dbo.[OrderMaster] (
  [OrderMasterKey] int NOT NULL,
  [OrderDtm] datetime NULL,
  [OrderYear] nvarchar(4) NULL,
  [OrderWeek] nvarchar(20) NULL,
  [Manager] nvarchar(50) NULL,
  [CustKey] int NULL,
  [OrderCode] nvarchar(20) NULL,
  [Descr] nvarchar(200) NULL,
  [isDeleted] bit NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[PeriodDay] (
  [BaseYmd] nvarchar(10) NOT NULL,
  [BaseMonth] nvarchar(2) NULL,
  [YearMonth] nvarchar(7) NOT NULL,
  [YearMonthNm] nvarchar(8) NULL,
  [Yearuarter] nvarchar(7) NULL,
  [YearQuarterNm] nvarchar(8) NULL,
  [BaseYear] nvarchar(4) NULL,
  [YearNm] nvarchar(20) NULL,
  [WeekDay] int NULL,
  [WeekSeqNo] int NULL,
  [OrderYearWeek] nvarchar(7) NULL,
  [OrderWeek] nvarchar(2) NULL,
  [WeekStartYmd] nvarchar(10) NULL,
  [WeekEndYmd] nvarchar(10) NULL,
  [BaseDay] nvarchar(2) NULL
);
GO
CREATE TABLE dbo.[Product] (
  [ProdKey] int IDENTITY(1,1) NOT NULL,
  [ProdCode] nvarchar(100) NULL,
  [ProdName] nvarchar(200) NULL,
  [ProdGroup] nvarchar(50) NULL,
  [FlowerName] nvarchar(100) NULL,
  [CounName] nvarchar(100) NULL,
  [Cost] float NULL,
  [OutUnit] nvarchar(10) NULL,
  [EstUnit] nvarchar(10) NULL,
  [SearchComment] nvarchar(200) NULL,
  [UseType] nvarchar(10) NULL,
  [CountryFlower] nvarchar(100) NULL,
  [BunchOf1Box] float NULL,
  [SteamOf1Bunch] float NULL,
  [SteamOf1Box] float NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [Stock] float NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [BoxWeight] decimal(10,3) NULL,
  [BoxCBM] decimal(10,3) NULL,
  [TariffRate] decimal(10,4) NULL,
  [DisplayName] nvarchar(200) NULL
);
GO
CREATE TABLE dbo.[ProductStock] (
  [ProdKey] int NOT NULL,
  [StockKey] int NOT NULL,
  [Stock] float NULL
);
GO
CREATE TABLE dbo.[ShipmentDate] (
  [SdateKey] int IDENTITY(1,1) NOT NULL,
  [ShipmentDtm] datetime NULL,
  [ShipmentQuantity] float NULL,
  [SdetailKey] int NOT NULL,
  [EstQuantity] float NULL,
  [Cost] float NULL,
  [Amount] float NULL,
  [Vat] float NULL,
  [Descr] nvarchar(200) NULL
);
GO
CREATE TABLE dbo.[ShipmentDetail] (
  [SdetailKey] int NOT NULL,
  [CustKey] int NULL,
  [ProdKey] int NULL,
  [isFix] bit NULL,
  [ShipmentDtm] datetime NULL,
  [BoxQuantity] float NULL,
  [BunchQuantity] float NULL,
  [SteamQuantity] float NULL,
  [OutQuantity] float NULL,
  [EstQuantity] float NULL,
  [Cost] float NULL,
  [Amount] float NULL,
  [Vat] float NULL,
  [Descr] nvarchar(200) NULL,
  [EstDescr] nvarchar(200) NULL,
  [EstQuantity2] float NULL,
  [ShipmentKey] int NOT NULL
);
GO
CREATE TABLE dbo.[ShipmentFarm] (
  [SfarmKey] int IDENTITY(1,1) NOT NULL,
  [FarmKey] int NULL,
  [ShipmentQuantity] float NULL,
  [SdetailKey] int NOT NULL
);
GO
CREATE TABLE dbo.[ShipmentMaster] (
  [ShipmentKey] int NOT NULL,
  [OrderYear] nvarchar(4) NULL,
  [OrderWeek] nvarchar(20) NULL,
  [OrderYearWeek] nvarchar(20) NULL,
  [CustKey] int NULL,
  [isFix] bit NULL,
  [isDeleted] bit NULL,
  [EstimateName] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [WebCreated] bit NOT NULL DEFAULT ((0))
);
GO
CREATE TABLE dbo.[StockHistory] (
  [StockHistoryKey] int IDENTITY(1,1) NOT NULL,
  [ChangeDtm] datetime NULL,
  [OrderYear] nvarchar(4) NULL,
  [OrderWeek] nvarchar(20) NULL,
  [ChangeID] nvarchar(20) NULL,
  [ChangeType] nvarchar(20) NULL,
  [ColumName] nvarchar(20) NULL,
  [BeforeValue] float NULL,
  [AfterValue] float NULL,
  [Descr] nvarchar(500) NULL,
  [ProdKey] int NOT NULL
);
GO
CREATE TABLE dbo.[StockMaster] (
  [StockKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NULL,
  [OrderWeek] nvarchar(20) NULL,
  [OrderYearWeek] nvarchar(20) NULL,
  [isFix] tinyint NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[UserInfo] (
  [UserID] nvarchar(50) NOT NULL,
  [Password] nvarchar(20) NULL,
  [UserName] nvarchar(20) NULL,
  [DeptName] nvarchar(20) NULL,
  [Email] nvarchar(50) NULL,
  [Phone] nvarchar(20) NULL,
  [Authority] int NULL,
  [isDeleted] bit NULL,
  [Descr] nvarchar(200) NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL
);
GO
CREATE TABLE dbo.[WarehouseDetail] (
  [WdetailKey] int IDENTITY(1,1) NOT NULL,
  [ProdKey] int NULL,
  [OrderCode] nvarchar(20) NULL,
  [BoxQuantity] float NULL,
  [BunchQuantity] float NULL,
  [SteamQuantity] float NULL,
  [OutQuantity] float NULL,
  [EstQuantity] float NULL,
  [UPrice] float NULL,
  [TPrice] float NULL,
  [WarehouseKey] int NOT NULL,
  [SteamOf1Box] float NULL,
  [SteamOf1Bunch] float NULL
);
GO
CREATE TABLE dbo.[WarehouseMaster] (
  [WarehouseKey] int NOT NULL,
  [UploadDtm] datetime NULL,
  [FileName] nvarchar(500) NULL,
  [OrderYear] nvarchar(4) NULL,
  [OrderWeek] nvarchar(20) NULL,
  [FarmName] nvarchar(100) NULL,
  [InvoiceNo] nvarchar(50) NULL,
  [InputDate] datetime NULL,
  [OrderNo] nvarchar(50) NULL,
  [isDeleted] bit NULL,
  [CreateID] nvarchar(50) NULL,
  [CreateDtm] datetime NULL,
  [LastUpdateID] nvarchar(50) NULL,
  [LastUpdateDtm] datetime NULL,
  [GrossWeight] decimal(10,2) NULL,
  [ChargeableWeight] decimal(10,2) NULL,
  [FreightRateUSD] decimal(10,4) NULL,
  [DocFeeUSD] decimal(10,2) NULL
);
GO
CREATE TABLE dbo.[WebArrivalCostHistory] (
  [HistoryKey] bigint IDENTITY(1,1) NOT NULL,
  [ArrivalLineKey] int NULL,
  [ImportKey] int NULL,
  [ActionType] nvarchar(30) NOT NULL,
  [BeforeJson] nvarchar(max) NULL,
  [AfterJson] nvarchar(max) NULL,
  [ChangedBy] nvarchar(100) NOT NULL DEFAULT (N''),
  [ChangedByName] nvarchar(100) NOT NULL DEFAULT (N''),
  [ChangedAt] datetime NOT NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebArrivalCostImport] (
  [ImportKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [UploadFileName] nvarchar(260) NOT NULL DEFAULT (N''),
  [RevisionNo] int NOT NULL DEFAULT ((1)),
  [ScopeJson] nvarchar(max) NULL,
  [UploadedBy] nvarchar(100) NOT NULL DEFAULT (N''),
  [UploadedByName] nvarchar(100) NOT NULL DEFAULT (N''),
  [UploadedAt] datetime NOT NULL DEFAULT (getdate()),
  [IsDeleted] bit NOT NULL DEFAULT ((0))
);
GO
CREATE TABLE dbo.[WebArrivalCostLine] (
  [ArrivalLineKey] int IDENTITY(1,1) NOT NULL,
  [ImportKey] int NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [OrderWeek] nvarchar(10) NOT NULL DEFAULT (N''),
  [CountryName] nvarchar(100) NOT NULL DEFAULT (N''),
  [FlowerNameRaw] nvarchar(200) NOT NULL DEFAULT (N''),
  [ProductNameRaw] nvarchar(300) NOT NULL DEFAULT (N''),
  [FarmNameRaw] nvarchar(200) NOT NULL DEFAULT (N''),
  [ProdKey] int NULL,
  [FarmKey] int NULL,
  [Unit] nvarchar(40) NOT NULL DEFAULT (N''),
  [Quantity] decimal(18,4) NOT NULL DEFAULT ((0)),
  [FobUSD] decimal(18,6) NULL,
  [FreightPerUnitUSD] decimal(18,6) NULL,
  [CustomsPerUnitKRW] decimal(18,4) NULL,
  [OtherPerUnitKRW] decimal(18,4) NULL,
  [SourceArrivalCostKRW] decimal(18,4) NULL,
  [SourceArrivalCostVatKRW] decimal(18,4) NULL,
  [SelectedArrivalCostKRW] decimal(18,4) NULL,
  [ExchangeRate] decimal(18,6) NULL,
  [GrossWeight] decimal(18,4) NULL,
  [ChargeableWeight] decimal(18,4) NULL,
  [FreightUSD] decimal(18,6) NULL,
  [InvoiceUSD] decimal(18,6) NULL,
  [WeightMetricShare] decimal(18,8) NULL,
  [VolumeMetricShare] decimal(18,8) NULL,
  [ValueMetricShare] decimal(18,8) NULL,
  [AllocationBasis] nvarchar(20) NOT NULL DEFAULT (N'SOURCE'),
  [MatchStatus] nvarchar(30) NOT NULL DEFAULT (N'PRODUCT_REQUIRED'),
  [SourceFileName] nvarchar(260) NOT NULL DEFAULT (N''),
  [SheetName] nvarchar(120) NOT NULL DEFAULT (N''),
  [SourceRow] int NULL,
  [RawJson] nvarchar(max) NULL,
  [Notes] nvarchar(1000) NOT NULL DEFAULT (N''),
  [IsCurrent] bit NOT NULL DEFAULT ((1)),
  [CreatedBy] nvarchar(100) NOT NULL DEFAULT (N''),
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedBy] nvarchar(100) NOT NULL DEFAULT (N''),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebColombiaWeekly] (
  [AutoKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [OrderWeek] nvarchar(10) NOT NULL,
  [GW] float NULL,
  [CW] float NULL,
  [HandlingFee] float NULL,
  [ItemCount] float NULL,
  [Truck1t] float NULL,
  [Truck2_5t] float NULL,
  [Truck5t] float NULL,
  [CustomsFee] float NULL,
  [DisinfectFee] float NULL,
  [QuarantineDeductFee] float NULL,
  [AirRateUSD] float NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate()),
  [BakSangRateApplied] float NULL
);
GO
CREATE TABLE dbo.[WebCustomsHistory] (
  [HistoryKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [ScopeType] nvarchar(20) NOT NULL,
  [ScopeKey] nvarchar(60) NOT NULL,
  [FieldName] nvarchar(40) NOT NULL,
  [OldValue] float NULL,
  [NewValue] float NULL,
  [ChangedBy] nvarchar(50) NULL,
  [ChangedAt] datetime NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebCustomsRateConfig] (
  [ConfigKey] nvarchar(40) NOT NULL,
  [Value] float NOT NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebCustomsRateHistory] (
  [AutoKey] int IDENTITY(1,1) NOT NULL,
  [ConfigKey] nvarchar(40) NOT NULL,
  [EffectiveOrderYear] nvarchar(4) NOT NULL,
  [EffectiveMajorWeek] nvarchar(4) NOT NULL,
  [Value] float NOT NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebCustomsWeekly] (
  [AutoKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [MajorWeek] nvarchar(4) NOT NULL,
  [Category] nvarchar(60) NOT NULL,
  [GW1] float NULL,
  [GW2] float NULL,
  [Customs1] float NULL,
  [Customs2] float NULL,
  [SunYul1] float NULL,
  [SunYul2] float NULL,
  [WorldFreight1] float NULL,
  [WorldFreight2] float NULL,
  [Quarantine1] float NULL,
  [Quarantine2] float NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate()),
  [Customs1_1] float NULL,
  [Customs1_2] float NULL,
  [Customs1_3] float NULL,
  [Customs2_1] float NULL,
  [Customs2_2] float NULL,
  [Customs2_3] float NULL,
  [SunYul1_1] float NULL,
  [SunYul1_2] float NULL,
  [SunYul1_3] float NULL,
  [SunYul2_1] float NULL,
  [SunYul2_2] float NULL,
  [SunYul2_3] float NULL,
  [WorldFreight1Manual] bit NULL,
  [WorldFreight2Manual] bit NULL,
  [BakSangRateApplied] float NULL
);
GO
CREATE TABLE dbo.[WebForwardingWeekly] (
  [AutoKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [MajorWeek] nvarchar(4) NOT NULL,
  [Category] nvarchar(60) NOT NULL,
  [AmountUSD] float NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebInvoiceCostLine] (
  [CostRevisionId] uniqueidentifier NOT NULL,
  [LineId] uniqueidentifier NOT NULL,
  [DocumentId] uniqueidentifier NOT NULL,
  [DocumentRevision] int NOT NULL,
  [OperationId] uniqueidentifier NOT NULL,
  [WarehouseKey] int NOT NULL,
  [WdetailKey] int NOT NULL,
  [ProdKey] int NOT NULL,
  [Unit] nvarchar(40) NOT NULL,
  [Quantity] decimal(18,6) NOT NULL,
  [CostPerUnit] decimal(18,6) NULL,
  [TotalCost] decimal(18,6) NULL,
  [ComponentAmountsJson] nvarchar(max) NULL
);
GO
CREATE TABLE dbo.[WebInvoiceCostRevision] (
  [CostRevisionId] uniqueidentifier NOT NULL,
  [DocumentId] uniqueidentifier NOT NULL,
  [DocumentRevision] int NOT NULL,
  [OperationId] uniqueidentifier NOT NULL,
  [WarehouseKey] int NOT NULL,
  [RevisionNo] int NOT NULL,
  [Basis] nvarchar(20) NOT NULL,
  [Status] nvarchar(20) NOT NULL,
  [Currency] char(3) NOT NULL,
  [FormulaId] nvarchar(100) NOT NULL,
  [FormulaVersion] nvarchar(50) NOT NULL,
  [FormulaSourceHash] binary(32) NOT NULL,
  [InputSnapshotJson] nvarchar(max) NOT NULL,
  [ApprovedBy] nvarchar(200) NULL,
  [ApprovedAt] datetime2(3) NULL,
  [CreatedBy] nvarchar(200) NOT NULL,
  [CreatedAt] datetime2(3) NOT NULL
);
GO
CREATE TABLE dbo.[WebInvoiceDocument] (
  [DocumentId] uniqueidentifier NOT NULL,
  [OrderYear] char(4) NOT NULL,
  [OrderWeek] char(5) NOT NULL,
  [Revision] int NOT NULL,
  [FarmKey] int NULL,
  [InvoiceNo] nvarchar(100) NULL,
  [InvoiceYear] char(4) NULL,
  [SourceHash] binary(32) NOT NULL,
  [OriginalFileName] nvarchar(520) NOT NULL,
  [BusinessKeyHash] binary(32) NULL,
  [ReceiptStatus] nvarchar(20) NOT NULL,
  [CostStatus] nvarchar(20) NOT NULL,
  [RawMetadataJson] nvarchar(max) NULL,
  [ReviewedMetadataJson] nvarchar(max) NULL,
  [CreatedBy] nvarchar(200) NOT NULL,
  [CreatedAt] datetime2(3) NOT NULL,
  [UpdatedBy] nvarchar(200) NOT NULL,
  [UpdatedAt] datetime2(3) NOT NULL,
  [RowVersion] timestamp NOT NULL
);
GO
CREATE TABLE dbo.[WebInvoiceHistory] (
  [HistoryId] bigint IDENTITY(1,1) NOT NULL,
  [DocumentId] uniqueidentifier NOT NULL,
  [Revision] int NOT NULL,
  [OperationId] uniqueidentifier NULL,
  [Action] nvarchar(60) NOT NULL,
  [BeforeJson] nvarchar(max) NULL,
  [AfterJson] nvarchar(max) NULL,
  [Reason] nvarchar(1000) NULL,
  [Actor] nvarchar(200) NOT NULL,
  [CreatedAt] datetime2(3) NOT NULL
);
GO
CREATE TABLE dbo.[WebInvoiceLine] (
  [DocumentId] uniqueidentifier NOT NULL,
  [Revision] int NOT NULL,
  [LineId] uniqueidentifier NOT NULL,
  [LineNo] int NOT NULL,
  [OriginalName] nvarchar(500) NOT NULL,
  [LengthText] nvarchar(100) NULL,
  [ProdKey] int NULL,
  [BoxQuantity] decimal(18,6) NULL,
  [BunchQuantity] decimal(18,6) NULL,
  [StemQuantity] decimal(18,6) NULL,
  [PriceUnit] nvarchar(40) NULL,
  [UnitPrice] decimal(18,6) NULL,
  [Currency] char(3) NULL,
  [LineAmount] decimal(18,6) NULL,
  [SourceEvidenceJson] nvarchar(max) NULL,
  [ReviewedJson] nvarchar(max) NULL
);
GO
CREATE TABLE dbo.[WebInvoiceOperation] (
  [OperationId] uniqueidentifier NOT NULL,
  [DocumentId] uniqueidentifier NOT NULL,
  [DocumentRevision] int NOT NULL,
  [ReceiptPartId] uniqueidentifier NOT NULL,
  [RequestHash] binary(32) NOT NULL,
  [Action] nvarchar(20) NOT NULL,
  [Status] nvarchar(20) NOT NULL,
  [WarehouseKey] int NULL,
  [ResultJson] nvarchar(max) NULL,
  [ErrorCode] nvarchar(100) NULL,
  [Actor] nvarchar(200) NOT NULL,
  [CreatedAt] datetime2(3) NOT NULL,
  [CompletedAt] datetime2(3) NULL
);
GO
CREATE TABLE dbo.[WebProfitReport] (
  [AutoKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [MajorWeek] nvarchar(4) NOT NULL,
  [Category] nvarchar(60) NOT NULL,
  [ColKey] nvarchar(20) NOT NULL,
  [Value] float NULL,
  [TextValue] nvarchar(2000) NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate()),
  [SourceRef] nvarchar(500) NULL,
  [EffectiveAt] datetime2(7) NULL,
  [ConfirmedBy] nvarchar(100) NULL,
  [ConfirmedAt] datetime2(7) NULL
);
GO
CREATE TABLE dbo.[WebProfitReportConfirm] (
  [ConfirmKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [MajorWeek] nvarchar(4) NOT NULL,
  [RevisionNo] int NOT NULL DEFAULT ((1)),
  [IsActive] bit NOT NULL DEFAULT ((1)),
  [BeginOrderYear] nvarchar(4) NULL,
  [BeginOrderWeek] nvarchar(10) NULL,
  [BeginStockKey] int NULL,
  [EndOrderYear] nvarchar(4) NULL,
  [EndOrderWeek] nvarchar(10) NULL,
  [EndStockKey] int NULL,
  [SourceHash] nvarchar(128) NULL,
  [AuditStatus] nvarchar(20) NULL,
  [AuditIssuesJson] nvarchar(max) NULL,
  [IsForced] bit NOT NULL DEFAULT ((0)),
  [ForceReason] nvarchar(1000) NULL,
  [ConfirmedBy] nvarchar(50) NULL,
  [ConfirmedByName] nvarchar(100) NULL,
  [ConfirmedAt] datetime NOT NULL DEFAULT (getdate()),
  [CancelledBy] nvarchar(50) NULL,
  [CancelledByName] nvarchar(100) NULL,
  [CancelledAt] datetime NULL,
  [Notes] nvarchar(2000) NULL
);
GO
CREATE TABLE dbo.[WebProfitReportConfirmDetail] (
  [ConfirmDetailKey] int IDENTITY(1,1) NOT NULL,
  [ConfirmKey] int NOT NULL,
  [Category] nvarchar(60) NOT NULL,
  [ColType] nvarchar(12) NOT NULL,
  [ColKey] nvarchar(20) NOT NULL,
  [Value] decimal(38,10) NULL,
  [TextValue] nvarchar(2000) NULL
);
GO
CREATE TABLE dbo.[WebProfitReportSnapshot] (
  [SnapKey] int IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [MajorWeek] nvarchar(4) NOT NULL,
  [VersionNo] int NOT NULL,
  [CalcVersion] nvarchar(60) NOT NULL,
  [FingerprintHash] nvarchar(64) NOT NULL,
  [FingerprintJson] nvarchar(max) NOT NULL,
  [PayloadJson] nvarchar(max) NOT NULL,
  [PayloadHash] nvarchar(64) NOT NULL,
  [PrevPayloadHash] nvarchar(64) NULL,
  [Reason] nvarchar(20) NOT NULL,
  [ChangedFromPrev] bit NOT NULL DEFAULT ((1)),
  [ComputeMs] int NULL,
  [CreatedBy] nvarchar(100) NOT NULL,
  [CreatedAt] datetime2(7) NOT NULL DEFAULT (sysutcdatetime())
);
GO
CREATE TABLE dbo.[WebStockPrice] (
  [ProdKey] int NOT NULL,
  [Price] float NOT NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NULL DEFAULT (getdate())
);
GO
CREATE TABLE dbo.[WebStockPriceEvidence] (
  [EvidenceKey] bigint IDENTITY(1,1) NOT NULL,
  [OrderYear] nvarchar(4) NOT NULL,
  [OrderWeek] nvarchar(10) NOT NULL,
  [ProdKey] int NOT NULL,
  [Price] float NOT NULL,
  [SourceRef] nvarchar(500) NOT NULL,
  [EffectiveAt] datetime2(7) NOT NULL,
  [ConfirmedBy] nvarchar(100) NOT NULL,
  [ConfirmedAt] datetime2(7) NOT NULL,
  [EvidenceStatus] nvarchar(20) NOT NULL,
  [UpdatedBy] nvarchar(50) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate())
);
GO
CREATE VIEW [dbo].[ViewOrder] AS
   SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek, SUBSTRING(om.OrderWeek,0,3) OrderWeek2, om.OrderYear + SUBSTRING(om.OrderWeek, 0, 3) OrderYearWeek, om.OrderYear + REPLACE(om.OrderWeek,'-', '') OrderYearWeek2,
          om.OrderDtm, ui.UserName Manager, om.CustKey, c.CustName, c.CustArea, c.Manager BusinessManager, c.Descr CustDescr, ct.isUseOrderCode, om.OrderCode, om.Descr,
          od.OrderDetailKey, od.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower, od.Descr DetailDescr, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity, od.EstQuantity, od.NoneOutQuantity
     FROM OrderMaster om
     JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey
     JOIN Customer c ON om.CustKey = c.CustKey
     JOIN Product p ON od.ProdKey = p.ProdKey
     JOIN Country ct ON p.CounName = ct.CounName
     JOIN UserInfo ui ON om.Manager = ui.UserID
    WHERE om.isDeleted = 0 AND od.isDeleted = 0
GO
CREATE VIEW [dbo].[ViewShipment] AS
   SELECT sm.ShipmentKey, sm.OrderYear, sm.OrderWeek, SUBSTRING(sm.OrderWeek,0,3) OrderWeek2, sm.OrderYearWeek, sm.OrderYear + REPLACE(sm.OrderWeek,'-', '') OrderYearWeek2, sm.isFix MasterFix,
          sd.ProdKey, p.ProdName, p.ProdCode, p.FlowerName, p.CounName, p.CountryFlower, sm.CustKey, c.CustCode, c.CustName, c.CustArea, c.Manager, c.Descr CustDescr,
          sd.ShipmentDtm, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity, sd.OutQuantity, sd.EstQuantity, sd.Cost, sd.Amount, sd.Vat, sd.Descr, sd.EstQuantity2, sd.EstDescr, sd.isFix DetailFix, sd.SdetailKey
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Product p ON sd.ProdKey = p.ProdKey
     JOIN Customer c ON sm.CustKey = c.CustKey
    WHERE sm.isDeleted = 0
GO






CREATE VIEW [dbo].[ViewWarehouse] AS
   SELECT wm.WarehouseKey,
          wm.UploadDtm,
          wm.FileName,
          wm.OrderYear,
          wm.OrderWeek,
		  SUBSTRING(wm.OrderWeek,0,3) OrderWeek2,
		  wm.OrderYear + REPLACE(wm.OrderWeek,'-', '') OrderYearWeek2,
          wm.FarmName,
		  wm.OrderNo,
		  f.CounKey,
		  wm.InvoiceNo,
          wd.OrderCode,
          wm.InputDate,
          wd.WdetailKey,
          wd.ProdKey,
          p.ProdName,
          p.FlowerName,
          p.CounName,
          p.CountryFlower,
          wd.BoxQuantity,
          wd.BunchQuantity,
          wd.SteamQuantity,
          wd.OutQuantity,
          wd.EstQuantity,
          wd.UPrice,
          wd.TPrice
     FROM WarehouseMaster wm
     JOIN      WarehouseDetail wd
       ON wm.WarehouseKey = wd.WarehouseKey
     JOIN      Product p
       ON wd.ProdKey = p.ProdKey
     LEFT JOIN Farm f
       ON wm.FarmName = f.FarmName AND f.isDeleted = 0
    WHERE wm.isDeleted = 0 


GO
CREATE UNIQUE INDEX UX_ApprovalProfitActive ON WebProfitReportConfirm(OrderYear,MajorWeek) WHERE IsActive=1;
CREATE UNIQUE INDEX UX_ApprovalProfitRevision ON WebProfitReportConfirm(OrderYear,MajorWeek,RevisionNo);
CREATE UNIQUE INDEX UX_ApprovalProfitSnapshot ON WebProfitReportSnapshot(OrderYear,MajorWeek,VersionNo);
GO
