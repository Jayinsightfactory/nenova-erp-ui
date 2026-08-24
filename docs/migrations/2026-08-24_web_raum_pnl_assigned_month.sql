-- 라움 손익 차수별 월 수동 배정(웹 전용). ERP 원장은 변경하지 않는다.
IF OBJECT_ID('dbo.WebRaumPnl', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.WebRaumPnl', 'AssignedMonth') IS NULL
BEGIN
  ALTER TABLE dbo.WebRaumPnl ADD AssignedMonth CHAR(7) NULL;
END;
