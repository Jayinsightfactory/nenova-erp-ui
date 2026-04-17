-- ============================================================================
-- 2026-04-17  CurrencyMaster: CNY(중국 위안) 추가 + 환율 업데이트 예시
-- SSMS 에서 직접 실행. idempotent — 재실행 안전.
-- ============================================================================

-- CNY 추가 (없을 때만)
IF NOT EXISTS (SELECT 1 FROM CurrencyMaster WHERE CurrencyCode='CNY')
BEGIN
  INSERT INTO CurrencyMaster (CurrencyCode, CurrencyName, ExchangeRate, UpdateDtm, IsActive)
  VALUES ('CNY', N'중국 위안', 188.0, FORMAT(GETDATE(),'yyyy-MM-dd HH:mm:ss'), 1);
END;

-- 현재 환율 확인 (참고용)
SELECT CurrencyCode, CurrencyName, ExchangeRate, UpdateDtm, IsActive
  FROM CurrencyMaster
 WHERE IsActive = 1
 ORDER BY CurrencyCode;

-- 주기적으로 최신 환율 업데이트 예시 (사용자가 수동 또는 크론으로 수행)
-- UPDATE CurrencyMaster SET ExchangeRate=1350, UpdateDtm=FORMAT(GETDATE(),'yyyy-MM-dd HH:mm:ss') WHERE CurrencyCode='USD';
-- UPDATE CurrencyMaster SET ExchangeRate=1450, UpdateDtm=FORMAT(GETDATE(),'yyyy-MM-dd HH:mm:ss') WHERE CurrencyCode='EUR';
-- UPDATE CurrencyMaster SET ExchangeRate=188,  UpdateDtm=FORMAT(GETDATE(),'yyyy-MM-dd HH:mm:ss') WHERE CurrencyCode='CNY';
