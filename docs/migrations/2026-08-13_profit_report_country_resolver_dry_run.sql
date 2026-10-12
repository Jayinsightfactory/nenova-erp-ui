-- 읽기 전용 사전점검. DML/DDL/EXEC 없음.
-- 국내/왁스 placeholder 중 CHINA 우선분류와 국내 샘플 후보를 운영 반영 전에 확인한다.
SELECT
  p.ProdKey,
  p.ProdName,
  p.CounName,
  p.FlowerName,
  CASE
    WHEN UPPER(ISNULL(p.ProdName,N'')) LIKE N'%CHINA%' OR ISNULL(p.ProdName,N'') LIKE N'%중국%' THEN N'중국'
    WHEN ISNULL(p.CounName,N'') LIKE N'%국내%'
     AND ISNULL(p.FlowerName,N'') LIKE N'%왁스%'
     AND ISNULL(p.ProdName,N'') LIKE N'%샘플%' THEN N'국내'
    ELSE N'검토'
  END AS ProposedProfitCategory
FROM dbo.Product p
WHERE ISNULL(p.isDeleted,0)=0
  AND (
    UPPER(ISNULL(p.ProdName,N'')) LIKE N'%CHINA%'
    OR ISNULL(p.ProdName,N'') LIKE N'%중국%'
    OR (
      ISNULL(p.CounName,N'') LIKE N'%국내%'
      AND ISNULL(p.FlowerName,N'') LIKE N'%왁스%'
      AND ISNULL(p.ProdName,N'') LIKE N'%샘플%'
    )
  )
ORDER BY ProposedProfitCategory, p.ProdName, p.ProdKey;

SELECT CurrencyCode, CurrencyName, ExchangeRate, IsActive, UpdateDtm
FROM dbo.CurrencyMaster
WHERE CurrencyCode IN (N'AUD',N'CNY',N'EUR',N'JPY',N'USD')
ORDER BY CurrencyCode;
