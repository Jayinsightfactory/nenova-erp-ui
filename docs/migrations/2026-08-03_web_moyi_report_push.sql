/*
  Nenovaweb → MOYI 주차별 매출이익 보고서 전송 감사 이력.
  ERP 원장(Order/Shipment/Stock/Estimate)은 변경하지 않는다.
  API가 최초 호출 시에도 같은 CREATE IF NOT EXISTS를 실행하므로 운영 적용은 멱등이다.
*/
IF OBJECT_ID(N'dbo.WebMoyiReportPush', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebMoyiReportPush (
    PushId NVARCHAR(36) NOT NULL CONSTRAINT PK_WebMoyiReportPush PRIMARY KEY,
    ReportType NVARCHAR(40) NOT NULL,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    FileName NVARCHAR(255) NOT NULL,
    SizeBytes INT NULL,
    Sha256 NVARCHAR(64) NULL,
    State NVARCHAR(16) NOT NULL CONSTRAINT DF_WebMoyiReportPush_State DEFAULT 'pending',
    AttemptCount INT NOT NULL CONSTRAINT DF_WebMoyiReportPush_AttemptCount DEFAULT 0,
    ResponseStatus INT NULL,
    ResponseText NVARCHAR(2000) NULL,
    RemoteFileId NVARCHAR(36) NULL,
    ErrorText NVARCHAR(2000) NULL,
    RequestedBy NVARCHAR(100) NULL,
    RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_WebMoyiReportPush_RequestedAt DEFAULT GETDATE(),
    LastAttemptAt DATETIME2 NULL,
    SentAt DATETIME2 NULL
  );
END
