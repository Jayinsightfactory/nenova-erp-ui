/*
 * Dutch volume distribution executable fixture seed.
 * Load only after estimateDirectionalSchema.sql and estimateOverflowSchema.sql
 * inside a database named NenovaEstimateFixture_dutch_<12 hex chars>.
 * No production data or credentials are used by this fixture.
 */
IF DB_NAME() NOT LIKE N'NenovaEstimateFixture[_]dutch[_]%'
  THROW 51000, 'Dutch fixture seed may only run in NenovaEstimateFixture_dutch_* databases', 1;
GO

IF COL_LENGTH(N'dbo.Product', N'DisplayName') IS NULL
  ALTER TABLE dbo.Product ADD DisplayName nvarchar(200) NULL;
IF COL_LENGTH(N'dbo.Product', N'Descr') IS NULL
  ALTER TABLE dbo.Product ADD Descr nvarchar(1000) NULL;
IF COL_LENGTH(N'dbo.Customer', N'Descr') IS NULL
  ALTER TABLE dbo.Customer ADD Descr nvarchar(1000) NULL;
IF COL_LENGTH(N'dbo.Customer', N'CustArea') IS NULL
  ALTER TABLE dbo.Customer ADD CustArea nvarchar(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.ShipmentDetail') AND name=N'CustKey' AND is_nullable=0)
  ALTER TABLE dbo.ShipmentDetail ALTER COLUMN CustKey int NULL;
GO

INSERT dbo.UserInfo(UserID,UserName) VALUES(N'dutch-fixture',N'Dutch Fixture');
INSERT dbo.Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay)
  VALUES (533,N'Dutch existing-order',N'dutch-fixture',N'D533',4),
         (534,N'Dutch new-order',N'dutch-fixture',N'D534',4);
INSERT dbo.Country(CounName) VALUES(N'네덜란드');

INSERT dbo.Product(ProdKey,ProdName,DisplayName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
                   BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
  VALUES (2231,N'Dutch Test Rose Red',N'Dutch Test Rose Red',N'fixture-dutch-roses',N'네덜란드',N'Rose',N'송이',N'송이',0,0,0,2100,0),
         (2232,N'Dutch Test Rose White',N'Dutch Test Rose White',N'fixture-dutch-roses',N'네덜란드',N'Rose',N'단',N'송이',30,10,300,1800,0),
         (2233,N'Dutch Test Rose Pink',N'Dutch Test Rose Pink',N'fixture-dutch-roses',N'네덜란드',N'Rose',N'송이',N'송이',0,0,0,1600,0),
         (2234,N'Dutch Other Flower',N'Dutch Other Flower',N'fixture-dutch-other',N'네덜란드',N'Tulip',N'송이',N'송이',0,0,0,900,0),
         (2235,N'Dutch Fractional Date Product',N'Dutch Fractional Date Product',N'fixture-dutch-roses',N'네덜란드',N'Rose',N'단',N'송이',30,10,300,1000,0),
         (2236,N'Lily la Nubia',N'Lily la Nubia',N'fixture-dutch-matchers',N'네덜란드',N'백합',N'송이',N'송이',0,0,0,1200,0),
         (2237,N'Hydrangea / Royal Palace Old Pink/Green 60cm-18cm',N'Hydrangea / Royal Palace Old Pink/Green 60cm-18cm',N'fixture-dutch-matchers',N'네덜란드',N'수국',N'송이',N'송이',0,0,0,1300,0),
         (2238,N'Hydrangea / Royal Palace Old Pink/Green 60cm-18cm',N'Hydrangea / Royal Palace Old Pink/Green 60cm-18cm',N'fixture-dutch-matchers',N'네덜란드',N'수국',N'송이',N'송이',0,0,0,1300,0),
         (2239,N'ALSTROMERIA Lavender',N'ALSTROMERIA Lavender',N'fixture-dutch-matchers',N'네덜란드',N'알스트로',N'단',N'송이',16,10,160,1400,0);

-- 2025 and 2026 deliberately share short week 40-01; only the selected year may change.
INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,OrderDtm,CreateID)
  VALUES (44001,N'2026',N'40-01',N'202640',533,N'dutch-fixture','2026-10-01',N'dutch-fixture'),
         (44002,N'2025',N'40-01',N'202540',533,N'dutch-fixture','2025-10-01',N'dutch-fixture'),
         (44003,N'2026',N'40-01',N'202640',534,N'dutch-fixture','2026-10-01',N'dutch-fixture');
INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,
                       OutQuantity,OrderQuantity,EstQuantity,NoneOutQuantity,CreateID)
  VALUES (44001,44001,533,2231,0,0,0,77,77,77,77,N'dutch-fixture'),
         (44002,44002,533,2231,0,0,0,55,55,55,55,N'dutch-fixture'),
         (44003,44003,534,2234,0,0,0,13,13,13,13,N'dutch-fixture'),
         (44004,44003,534,2235,0,1,10,1,1,10,1,N'dutch-fixture');

INSERT dbo.ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
  VALUES (54001,N'2026',N'40-01',N'202640',533,0,0,1,N'dutch-fixture'),
         (54002,N'2025',N'40-01',N'202540',533,0,0,1,N'dutch-fixture'),
         (54003,N'2026',N'40-01',N'202640',534,0,0,1,N'dutch-fixture');
INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,EstQuantity2,
                          BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix,EstDescr)
  VALUES (64001,54001,NULL,2231,50,50,50,0,0,0,2100,95455,9545,N'native-null-customer-preserve','2026-10-01',0,N''),
         (64002,54002,NULL,2231,55,55,55,0,0,0,1700,85000,8500,N'prior-year-sentinel','2025-10-02',0,N''),
         (64003,54003,NULL,2233,50,50,50,0,0,0,1600,72727,7273,N'category-omission-zero-sentinel','2026-10-01',0,N''),
         (64004,54003,NULL,2234,13,13,13,0,0,0,900,10636,1064,N'other-category-sentinel','2026-10-01',0,N''),
         (64005,54003,NULL,2235,1,10,10,0,1,10,1000,9091,909,N'multi-date-fractional-sentinel','2026-10-01',0,N'');
INSERT dbo.ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
  VALUES (64001,'2026-10-01',50,50,2100,95455,9545,N'current'),
         (64002,'2025-10-02',55,55,1700,85000,8500,N'prior'),
         (64003,'2026-10-01',50,50,1600,72727,7273,N'omission-zero'),
         (64004,'2026-10-01',13,13,900,10636,1064,N'other-category'),
         (64005,'2026-10-01',0.4,4,1000,3636,364,N'fractional-a'),
         (64005,'2026-10-02',0.6,6,1000,5455,545,N'fractional-b');
INSERT dbo.PeriodDay(OrderYearWeek,WeekDay,BaseYmd)
  VALUES (N'202640',4,CONVERT(datetime,'2026-10-01',121)),
         (N'202640',5,CONVERT(datetime,'2026-10-02',121)),
         (N'202540',5,CONVERT(datetime,'2025-10-02',121));

-- Native view/quote downstream sentinels are read-only assertions for this task.
INSERT dbo.Estimate(EstimateKey,ShipmentKey,ProdKey,EstimateType,Unit,SdetailKey,Quantity,Cost,Amount,Vat,isFix,Descr,EstimateDtm)
  VALUES (74001,54001,2231,N'fixture',N'송이',64001,50,2100,95455,9545,0,N'preserve', '2026-10-02');
CREATE TABLE dbo.WebProfitReport (
  ReportKey int NOT NULL PRIMARY KEY,
  OrderYear nvarchar(4) NOT NULL,
  OrderWeek nvarchar(20) NOT NULL,
  CustKey int NOT NULL,
  ProdKey int NOT NULL,
  Amount decimal(18,4) NOT NULL,
  Vat decimal(18,4) NOT NULL
);
INSERT dbo.WebProfitReport(ReportKey,OrderYear,OrderWeek,CustKey,ProdKey,Amount,Vat)
  VALUES (84001,N'2026',N'40-01',533,2231,95455,9545);
GO
