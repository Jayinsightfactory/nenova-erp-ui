-- Estimate.Descr: 운영 로그(차감수량 등)만 제거, 사용자 직접 입력 메모는 유지
-- 기존 fn: 패턴 포함 시 전체 Descr 삭제 → 사용자 메모까지 손실

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

  -- 단일 토큰: 운영 로그만이면 제거
  IF CHARINDEX(CHAR(10), @s) = 0 AND CHARINDEX(CHAR(13), @s) = 0 AND CHARINDEX(N',', @s) = 0
  BEGIN
    IF @s LIKE N'%차감수량%' OR @s LIKE N'%차감단가%'
       OR @s LIKE N'%수량%변동%' OR @s LIKE N'%분배%변동%' OR @s LIKE N'%단가%변경%'
      RETURN N'';
    RETURN @s;
  END

  -- 다중 줄/쉼표: 운영 로그 라인만 제거 (웹 lib/estimateInvariants.js 와 동일 의도)
  DECLARE @out NVARCHAR(MAX) = N'';
  DECLARE @part NVARCHAR(MAX);
  DECLARE @pos INT;
  DECLARE @delim NCHAR(1);

  WHILE LEN(@s) > 0
  BEGIN
    SET @pos = PATINDEX(N'%[,' + CHAR(10) + CHAR(13) + N']%', @s);
    IF @pos = 0
    BEGIN
      SET @part = LTRIM(RTRIM(@s));
      SET @s = N'';
    END
    ELSE
    BEGIN
      SET @part = LTRIM(RTRIM(LEFT(@s, @pos - 1)));
      SET @s = LTRIM(RTRIM(SUBSTRING(@s, @pos + 1, LEN(@s))));
    END

    IF LEN(@part) = 0 CONTINUE;

    IF NOT (
      @part LIKE N'%차감수량%' OR @part LIKE N'%차감단가%'
      OR @part LIKE N'%수량%변동%' OR @part LIKE N'%분배%변동%' OR @part LIKE N'%단가%변경%'
    )
    BEGIN
      IF LEN(@out) > 0 SET @out = @out + N', ';
      SET @out = @out + @part;
    END
  END

  RETURN LTRIM(RTRIM(@out));
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
     AND dbo.fn_SanitizeEstimateDescr(i.Descr) <> ISNULL(i.Descr, N'');
END;
GO
