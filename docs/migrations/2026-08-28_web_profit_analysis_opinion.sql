-- 원인분석 탭 AI 소견 캐시 (웹 전용 — ERP 원장 아님). 멱등.
-- 근거팩(sha256)이 같으면 저장된 소견을 재사용해 LLM 재호출을 막는다.
IF OBJECT_ID(N'dbo.WebProfitAnalysisOpinion', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitAnalysisOpinion (
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(10) NOT NULL,
    Category NVARCHAR(80) NOT NULL,
    EvidenceHash NVARCHAR(64) NOT NULL,
    Opinion NVARCHAR(MAX) NOT NULL,
    Model NVARCHAR(60) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebProfitAnalysisOpinion_CreatedAt DEFAULT GETDATE(),
    CONSTRAINT PK_WebProfitAnalysisOpinion PRIMARY KEY (OrderYear, MajorWeek, Category)
  );
END
