-- 검역/불량/단가 차감(Estimate) 행 — 운영 로그(차감수량·차감단가) 비고 자동 제거
-- nenova.exe 견적서 관리·인쇄가 Estimate.Descr 를 그대로 표시하므로 INSERT/UPDATE 시 정리

IF OBJECT_ID(N'dbo.tr_Estimate_SanitizeDescr', N'TR') IS NOT NULL
  DROP TRIGGER dbo.tr_Estimate_SanitizeDescr;
GO

IF OBJECT_ID(N'dbo.fn_SanitizeEstimateDescr', N'FN') IS NOT NULL
  DROP FUNCTION dbo.fn_SanitizeEstimateDescr;
GO

CREATE FUNCTION dbo.fn_SanitizeEstimateDescr(@text NVARCHAR(MAX))
RETURNS NVARCHAR(MAX)
AS
BEGIN
  DECLARE @s NVARCHAR(MAX) = LTRIM(RTRIM(ISNULL(@text, N'')));
  IF @s = N'' RETURN N'';

  IF @s LIKE N'%차감수량%' OR @s LIKE N'%차감단가%'
     OR @s LIKE N'%수량%변동%' OR @s LIKE N'%분배%변동%' OR @s LIKE N'%단가%변경%'
    RETURN N'';

  -- 다중: 라인별 제거 — 2026-06-16 preserve_user_memo 마이그레이션 참고
  RETURN @s;
END;
GO

CREATE TRIGGER dbo.tr_Estimate_SanitizeDescr
ON dbo.Estimate
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE e
     SET Descr = dbo.fn_SanitizeEstimateDescr(i.Descr)
    FROM dbo.Estimate e
    INNER JOIN inserted i ON e.EstimateKey = i.EstimateKey
   WHERE ISNULL(i.EstimateType, N'') <> N'정상출고'
     AND ISNULL(i.Descr, N'') <> N''
     AND (
       i.Descr LIKE N'%차감수량%'
       OR i.Descr LIKE N'%차감단가%'
       OR i.Descr LIKE N'%수량%변동%'
       OR i.Descr LIKE N'%분배%변동%'
       OR i.Descr LIKE N'%단가%변경%'
     );
END;
GO
