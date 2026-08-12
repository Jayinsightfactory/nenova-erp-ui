-- docs/migrations/2026-08-12_web_profit_report_historical_seed.sql
-- 2026년 22~27차 매출원가 양식(원본 xlsx)의 그외통관비 구성요소·과세환율을 웹 전용 테이블에 seed 한다.
-- 자동 생성물: scripts/extract-profit-report-workbooks.mjs
--
-- * 멱등이다 — 같은 OrderYear/차수/카테고리 행이 이미 있으면 아무것도 하지 않는다(운영자 입력 보존).
-- * ERP 공용 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/
--   Estimate/ProductStock/StockHistory)은 읽지도 쓰지도 않는다. 웹 전용 테이블만 대상이다.
-- * SourceTag=N'excel_historical_snapshot' 으로 표시해 화면이 "운영자 저장값"과 구분해 보여준다.
-- * 이 seed를 실행하지 않아도 lib/profitReportHistoricalCustoms.js 가 같은 값을 런타임 snapshot 으로
--   제공한다. seed 는 "DB가 원천을 갖게 하는" 선택적 경로다.
-- * 선행 실행 필요: 2026-08-12_web_taxable_exchange_rate.sql (WebTaxableExchangeRate 생성)

SET XACT_ABORT ON;

IF COL_LENGTH('dbo.WebCustomsWeekly','SourceTag') IS NULL
  ALTER TABLE dbo.WebCustomsWeekly ADD SourceTag NVARCHAR(40) NULL;
GO
IF COL_LENGTH('dbo.WebColombiaWeekly','SourceTag') IS NULL
  ALTER TABLE dbo.WebColombiaWeekly ADD SourceTag NVARCHAR(40) NULL;
GO

BEGIN TRAN;

-- ── 2026 22차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'콜롬비아 수국', 4157, 1982, 0, 0, 69300, 69300, 275000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'네덜란드', 662, 0, 603820, 0, 198000, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'태국', 136, 0, 99848.7, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'호주', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'중국', 703, 354, 1120690, 394860, 138600, 69300, 187000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'에콰도르', 132, 0, 663160, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22', N'베트남', 292, 0, 882570, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 23차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'콜롬비아 수국', 2539, 1130, 0, 0, 69300, 0, 275000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'네덜란드', 149, 571, 156990, 79680, 79200, 128700, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'태국', 128, 0, 143430, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'호주', 264.1, 0, 21220, 0, 79200, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'중국', 819, 163, 1235560, 393010, 138600, 69300, 187000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'에콰도르', 136, 0, 661860, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23', N'베트남', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 24차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'콜롬비아 수국', 2606, 1487, 0, 0, 69300, 69300, 187000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'네덜란드', 491, 0, 195210, 0, 148500, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'태국', 109, 0, 131220, 0, 79200, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'호주', 647.6, 0, 0, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'중국', 475, 761, 810900, 1261300, 69300, 69300, 187000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'에콰도르', 119, 0, 595020, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24', N'베트남', 232, 0, 696750, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 25차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'콜롬비아 수국', 2452, 1397, 0, 0, 69300, 69300, 275000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'네덜란드', 100, 443, 142050, 189510, 69300, 158400, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'태국', 117, 0, 135830, 0, 116600, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'호주', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'중국', 488, 225, 790530, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'에콰도르', 200, 0, 1010570, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25', N'베트남', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 26차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'콜롬비아 수국', 2779, 1444, 0, 0, 69300, 69300, 275000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'네덜란드', 192, 520, 0, 242170, 69300, 148500, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'태국', 108, 0, 131570, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'호주', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'중국', 646, 201, 998650, 607690, 69300, 69300, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'에콰도르', 119, 0, 597680, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26', N'베트남', 270, 0, 818650, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 27차 국가별 그외통관비 구성요소 (백상요율 460원/kg)
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'콜롬비아 수국', 2847, 1661, 0, 0, 69300, 69300, 187000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'네덜란드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'네덜란드', 0, 456, 219910, 0, 148500, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'태국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'태국', 121, 0, 145170, 0, 79200, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'호주')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'호주', 566, 0, 168050, 0, 99000, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'미국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'미국', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'중국')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'중국', 563, 371, 1092570, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'에콰도르')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'에콰도르', 97, 0, 476750, 0, 69300, 0, 99000, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'이스라엘')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'이스라엘', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'뉴질랜드')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'뉴질랜드', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'일본')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'일본', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebCustomsWeekly WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'베트남')
  INSERT INTO dbo.WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2, WorldFreight1, WorldFreight2, Quarantine1, Quarantine2, BakSangRateApplied, WorldFreight1Manual, WorldFreight2Manual, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27', N'베트남', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 460, 1, 1, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 22-01 콜롬비아 4품목 반차수 구성요소 (백상요율 370원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'22-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22-01', 7530, 7530, 33000, 4, 0, 0, 1, 0, 0, 0, 370, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 22-02 콜롬비아 4품목 반차수 구성요소 (백상요율 370원/kg, 실제 트럭 1t×1/2.5t×0/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'22-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'22-02', 553, 553, 33000, 4, 1, 0, 0, 0, 0, 0, 370, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 23-01 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'23-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23-01', 6404, 6404, 33000, 4, 0, 0, 1, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 23-02 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×1/2.5t×0/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'23-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'23-02', 237, 265, 33000, 4, 1, 0, 0, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 24-01 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'24-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24-01', 6415, 6415, 33000, 4, 0, 0, 1, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 24-02 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×1/2.5t×0/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'24-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'24-02', 542, 659, 33000, 4, 1, 0, 0, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 25-01 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'25-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25-01', 6437, 6437, 33000, 4, 0, 0, 1, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 25-02 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×1/2.5t×0/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'25-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'25-02', 966, 966, 33000, 4, 1, 0, 0, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 26-01 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'26-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26-01', 6706, 6706, 33000, 4, 0, 0, 1, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 26-02 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×1/2.5t×0/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'26-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'26-02', 655, 670, 33000, 4, 1, 0, 0, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 27-01 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×0/5t×1)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'27-01')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27-01', 7020, 7020, 33000, 4, 0, 0, 1, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');
-- ── 2026 27-02 콜롬비아 4품목 반차수 구성요소 (백상요율 460원/kg, 실제 트럭 1t×0/2.5t×1/5t×0)
IF NOT EXISTS (SELECT 1 FROM dbo.WebColombiaWeekly WHERE OrderYear=N'2026' AND OrderWeek=N'27-02')
  INSERT INTO dbo.WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee, QuarantineDeductFee, BakSangRateApplied, SourceTag, UpdatedBy)
  VALUES (N'2026', N'27-02', 1371, 1371, 33000, 4, 0, 1, 0, 0, 0, 0, 460, N'excel_historical_snapshot', N'excel-historical-seed');

-- ── 2026 22~27차 과세환율(R) — 같은 통화라도 통관 신고 주차가 다르면 값이 다르므로 카테고리 단위로 저장한다.
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'콜롬비아 수국', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'콜롬비아 카네이션', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'콜롬비아 장미', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'콜롬비아 루스커스', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'콜롬비아 알스트로', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'네덜란드', 1754.12, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'태국', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'중국', 220.96, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'에콰도르', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'22' AND Category=N'베트남')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'22', N'', N'베트남', 1504.04, N'excel_historical_snapshot', N'매출원가 양식 - 22차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'콜롬비아 수국', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'콜롬비아 카네이션', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'콜롬비아 장미', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'콜롬비아 루스커스', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'콜롬비아 알스트로', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'네덜란드', 1761.08, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'호주')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'호주', 1079.48, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'태국', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'중국', 221.96, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'23' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'23', N'', N'에콰도르', 1507.15, N'excel_historical_snapshot', N'매출원가 양식 - 23차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'콜롬비아 수국', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'콜롬비아 카네이션', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'콜롬비아 장미', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'콜롬비아 루스커스', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'콜롬비아 알스트로', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'네덜란드', 1767.31, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'호주')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'호주', 1083.36, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'태국', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'중국', 226.09, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'에콰도르', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'24' AND Category=N'베트남')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'24', N'', N'베트남', 1514.68, N'excel_historical_snapshot', N'매출원가 양식 - 24차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'콜롬비아 수국', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'콜롬비아 카네이션', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'콜롬비아 장미', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'콜롬비아 루스커스', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'콜롬비아 알스트로', 1531.46, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'네덜란드', 1751.87, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'태국', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'중국', 226.09, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'25' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'25', N'', N'에콰도르', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 25차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'콜롬비아 수국', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'콜롬비아 카네이션', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'콜롬비아 장미', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'콜롬비아 루스커스', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'콜롬비아 알스트로', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'네덜란드', 1753.54, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'태국', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'중국', 224.27, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'에콰도르', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'26' AND Category=N'베트남')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'26', N'', N'베트남', 1516.02, N'excel_historical_snapshot', N'매출원가 양식 - 26차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 수국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'콜롬비아 수국', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 카네이션')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'콜롬비아 카네이션', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 장미')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'콜롬비아 장미', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 루스커스')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'콜롬비아 루스커스', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'콜롬비아 알스트로')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'콜롬비아 알스트로', 1538.3, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'네덜란드')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'네덜란드', 1766.5, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'호주')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'호주', 1068.23, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'태국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'태국', 1548.52, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'중국')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'중국', 226.66, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');
IF NOT EXISTS (SELECT 1 FROM dbo.WebTaxableExchangeRate WHERE OrderYear=N'2026' AND MajorWeek=N'27' AND Category=N'에콰도르')
  INSERT INTO dbo.WebTaxableExchangeRate (OrderYear, MajorWeek, Currency, Category, Rate, RateSource, SourceNote, SavedBy)
  VALUES (N'2026', N'27', N'', N'에콰도르', 1548.52, N'excel_historical_snapshot', N'매출원가 양식 - 27차_재고수정.xlsx 본표 R열', N'excel-historical-seed');

COMMIT TRAN;
GO
