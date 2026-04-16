-- ============================================================================
-- 2026-04-16  운송기준원가 기능 DB 마이그레이션
-- SSMS 에서 직접 실행. idempotent — 재실행 안전.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Product: 품목별 박스당 무게/CBM/관세율 (NULL → Flower 기본값 fallback)
-- ─────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('Product','BoxWeight')  IS NULL ALTER TABLE Product ADD BoxWeight  DECIMAL(10,3) NULL;
IF COL_LENGTH('Product','BoxCBM')     IS NULL ALTER TABLE Product ADD BoxCBM     DECIMAL(10,3) NULL;
IF COL_LENGTH('Product','TariffRate') IS NULL ALTER TABLE Product ADD TariffRate DECIMAL(10,4) NULL;  -- 0.08 = 8%

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Flower: 카테고리(꽃 종류) 기본값
-- ─────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('Flower','BoxWeight')     IS NULL ALTER TABLE Flower ADD BoxWeight     DECIMAL(10,3) NULL;
IF COL_LENGTH('Flower','BoxCBM')        IS NULL ALTER TABLE Flower ADD BoxCBM        DECIMAL(10,3) NULL;
IF COL_LENGTH('Flower','StemsPerBox')   IS NULL ALTER TABLE Flower ADD StemsPerBox   DECIMAL(10,2) NULL;
IF COL_LENGTH('Flower','DefaultTariff') IS NULL ALTER TABLE Flower ADD DefaultTariff DECIMAL(10,4) NULL;

-- 초기값 (엑셀 템플릿 기준)
UPDATE Flower SET BoxWeight=8,   BoxCBM=10,  StemsPerBox=100, DefaultTariff=0 WHERE FlowerName IN (N'장미','ROSE');
UPDATE Flower SET BoxWeight=11,  BoxCBM=9,   StemsPerBox=300, DefaultTariff=0 WHERE FlowerName IN (N'카네이션','CARNATION');
UPDATE Flower SET BoxWeight=9.7, BoxCBM=7,   StemsPerBox=160, DefaultTariff=0 WHERE FlowerName IN (N'알스트로','ALSTROMERIA');
UPDATE Flower SET BoxWeight=8,   BoxCBM=9.6, StemsPerBox=625, DefaultTariff=0 WHERE FlowerName IN (N'루스커스','RUSCUS');

-- ─────────────────────────────────────────────────────────────────────────
-- 3. WarehouseMaster: AWB 문서 메타 (업로드 시 입력)
-- ─────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('WarehouseMaster','GrossWeight')      IS NULL ALTER TABLE WarehouseMaster ADD GrossWeight      DECIMAL(10,2) NULL;
IF COL_LENGTH('WarehouseMaster','ChargeableWeight') IS NULL ALTER TABLE WarehouseMaster ADD ChargeableWeight DECIMAL(10,2) NULL;
IF COL_LENGTH('WarehouseMaster','FreightRateUSD')   IS NULL ALTER TABLE WarehouseMaster ADD FreightRateUSD   DECIMAL(10,4) NULL;
IF COL_LENGTH('WarehouseMaster','DocFeeUSD')        IS NULL ALTER TABLE WarehouseMaster ADD DocFeeUSD        DECIMAL(10,2) NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. FreightCost: 원가 스냅샷 헤더 (WarehouseKey 당 active 1건)
-- ─────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('FreightCost','U') IS NULL
BEGIN
  CREATE TABLE FreightCost (
    FreightKey        INT IDENTITY(1,1) PRIMARY KEY,
    WarehouseKey      INT NOT NULL,
    WeightBasis       NVARCHAR(10) NOT NULL,          -- 'GW' | 'CBM'
    ExchangeRate      DECIMAL(10,4) NOT NULL,         -- 환율 KRW/USD
    GrossWeight       DECIMAL(10,2) NOT NULL,
    ChargeableWeight  DECIMAL(10,2) NOT NULL,
    FreightRateUSD    DECIMAL(10,4) NOT NULL,         -- Rate (USD/kg)
    DocFeeUSD         DECIMAL(10,2) NOT NULL,         -- 서류비
    InvoiceTotalUSD   DECIMAL(14,2) NULL,             -- SUM(TPrice) 스냅샷
    -- 통관 상수 스냅샷
    BakSangRate       DECIMAL(10,2) NOT NULL,         -- 백상 단가 (370)
    HandlingFee       DECIMAL(14,2) NOT NULL,         -- 통관수수료 (33000)
    QuarantinePerItem DECIMAL(14,2) NOT NULL,         -- 검역 단가 (10000)
    DomesticFreight   DECIMAL(14,2) NOT NULL,         -- 국내운송 (99000)
    DeductFee         DECIMAL(14,2) NOT NULL,         -- 겸역차감 (40000)
    ExtraFee          DECIMAL(14,2) NOT NULL,         -- 추가통관 (0 or 33000)
    CreateID          NVARCHAR(50) NULL,
    CreateDtm         DATETIME DEFAULT GETDATE(),
    UpdateID          NVARCHAR(50) NULL,
    UpdateDtm         DATETIME NULL,
    isDeleted         BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_FreightCost_WH FOREIGN KEY (WarehouseKey) REFERENCES WarehouseMaster(WarehouseKey)
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_FreightCost_Warehouse_Active')
  CREATE UNIQUE INDEX UX_FreightCost_Warehouse_Active
  ON FreightCost(WarehouseKey) WHERE isDeleted=0;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. FreightCostDetail: 품목별 동결 결과 (한 BILL 30~200행)
-- ─────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('FreightCostDetail','U') IS NULL
BEGIN
  CREATE TABLE FreightCostDetail (
    DetailKey          INT IDENTITY(1,1) PRIMARY KEY,
    FreightKey         INT NOT NULL,
    WarehouseDetailKey INT NULL,                      -- 원본 라인 참조 (audit)
    ProdKey            INT NOT NULL,
    ProdName           NVARCHAR(200) NULL,            -- denormalized
    FlowerName         NVARCHAR(100) NULL,
    FarmName           NVARCHAR(100) NULL,
    -- 입력 스냅샷
    SteamQty           DECIMAL(14,2) NULL,            -- 수량(송이) = E
    FOBUSD             DECIMAL(10,4) NULL,            -- F
    BoxQty             DECIMAL(10,2) NULL,
    BoxWeightUsed      DECIMAL(10,3) NULL,            -- resolved (Product or Flower)
    BoxCBMUsed         DECIMAL(10,3) NULL,
    StemsPerBoxUsed    DECIMAL(10,2) NULL,
    StemsPerBunch      DECIMAL(10,2) NULL,            -- N (사용자 입력/Product)
    SalePriceKRW       DECIMAL(14,2) NULL,            -- Q (사용자 입력/Product)
    TariffRate         DECIMAL(10,4) NULL,
    -- 계산 결과
    FreightPerStemUSD  DECIMAL(10,6) NULL,            -- G
    CNF_USD            DECIMAL(10,6) NULL,            -- H
    CNF_KRW            DECIMAL(14,4) NULL,            -- J
    TariffKRW          DECIMAL(14,2) NULL,            -- K = CNF_KRW * TariffRate
    CustomsPerStem     DECIMAL(14,4) NULL,            -- L
    ArrivalPerStem     DECIMAL(14,4) NULL,            -- M
    ArrivalPerBunch    DECIMAL(14,2) NULL,            -- O
    SalePriceExVAT     DECIMAL(14,2) NULL,            -- P
    ProfitPerBunch     DECIMAL(14,2) NULL,            -- S
    ProfitRate         DECIMAL(10,6) NULL,            -- T
    TotalSaleKRW       DECIMAL(14,2) NULL,            -- U
    TotalProfitKRW     DECIMAL(14,2) NULL,            -- V
    SortOrder          INT NULL,
    CONSTRAINT FK_FreightCostDetail_Freight FOREIGN KEY (FreightKey) REFERENCES FreightCost(FreightKey)
  );
  CREATE INDEX IX_FreightCostDetail_Freight ON FreightCostDetail(FreightKey);
END

-- ─────────────────────────────────────────────────────────────────────────
-- 검증 쿼리
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT TOP 5 ProdKey, ProdName, BoxWeight, BoxCBM, TariffRate FROM Product;
-- SELECT * FROM Flower;
-- SELECT TOP 5 WarehouseKey, FarmName, GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD FROM WarehouseMaster;
-- SELECT * FROM FreightCost;
-- SELECT * FROM FreightCostDetail;
