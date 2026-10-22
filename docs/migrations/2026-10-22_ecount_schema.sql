-- ecount 스키마: 이카운트 원본 데이터 보관소(검증 후 dbo 와 합침). 멱등. SQL Server 2016 호환(STRING_AGG 등 2017+ 금지).
-- 이 파일은 정적 부분(스키마·LoadBatch·Dataset·시드)만 담는다.
--  * ecount.[Raw_<PrgId>] 는 이카운트 엑셀 헤더가 열 이름이 되는 동적 테이블 → lib/ecountLedger/loader.js 가 생성/ALTER ADD.
--  * ecount.cmp_* 대조 뷰는 Raw 열 이름(한글/영문)에 따라 달라져 lib/ecountLedger/views.js 가 실제 열을 보고 CREATE OR ALTER VIEW 로 생성.
-- dbo ERP 원장·ecount_work·web_mgmt 는 읽기만 한다. 쓰기는 ecount 스키마만.

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'ecount')
  EXEC (N'CREATE SCHEMA ecount');
GO

IF OBJECT_ID(N'ecount.LoadBatch', N'U') IS NULL
BEGIN
  CREATE TABLE ecount.LoadBatch (
    BatchKey    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ecount_LoadBatch PRIMARY KEY,
    PrgId       NVARCHAR(20)  NOT NULL,
    MenuName    NVARCHAR(100) NULL,
    PeriodFrom  DATE NULL,
    PeriodTo    DATE NULL,
    Source      NVARCHAR(40)  NOT NULL,   -- legacy_snapshot | xlsx | daemon
    FileName    NVARCHAR(260) NULL,
    FileSha256  CHAR(64) NULL,
    RowCnt      INT NOT NULL CONSTRAINT DF_ecount_LoadBatch_RowCnt DEFAULT 0,      -- 입력 행 수
    InsertCnt   INT NOT NULL CONSTRAINT DF_ecount_LoadBatch_InsertCnt DEFAULT 0,   -- 실제 삽입
    DedupCnt    INT NOT NULL CONSTRAINT DF_ecount_LoadBatch_DedupCnt DEFAULT 0,    -- 다른 배치와 RowHash 중복으로 생략
    ScreenTotal DECIMAL(18,2) NULL,
    LoadedBy    NVARCHAR(60)  NULL,
    LoadedAt    DATETIME2 NOT NULL CONSTRAINT DF_ecount_LoadBatch_LoadedAt DEFAULT SYSDATETIME(),
    Note        NVARCHAR(400) NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ecount_LoadBatch_FileSha256' AND object_id = OBJECT_ID(N'ecount.LoadBatch'))
  CREATE UNIQUE INDEX UX_ecount_LoadBatch_FileSha256 ON ecount.LoadBatch (FileSha256) WHERE FileSha256 IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ecount_LoadBatch_Prg' AND object_id = OBJECT_ID(N'ecount.LoadBatch'))
  CREATE INDEX IX_ecount_LoadBatch_Prg ON ecount.LoadBatch (PrgId, BatchKey DESC);
GO

IF OBJECT_ID(N'ecount.Dataset', N'U') IS NULL
BEGIN
  CREATE TABLE ecount.Dataset (
    PrgId          NVARCHAR(20)  NOT NULL CONSTRAINT PK_ecount_Dataset PRIMARY KEY,
    MenuName       NVARCHAR(100) NOT NULL,
    Category       NVARCHAR(40)  NULL,
    KeyColumnsJson NVARCHAR(400) NULL,
    DateColumn     NVARCHAR(100) NULL,
    AmountColumn   NVARCHAR(100) NULL,
    IsActive       BIT NOT NULL CONSTRAINT DF_ecount_Dataset_IsActive DEFAULT 1
  );
END
GO

-- 시드(데이터 조회 화면). 이미 있으면 건드리지 않는다.
INSERT INTO ecount.Dataset (PrgId, MenuName, Category, KeyColumnsJson, DateColumn, AmountColumn)
SELECT v.PrgId, v.MenuName, v.Category, v.KeyColumnsJson, v.DateColumn, v.AmountColumn
FROM (VALUES
  (N'E040207', N'판매현황',              N'영업·구매',   N'["일자","거래처명","품목명"]', N'일자', N'합계'),
  (N'E040214', N'거래처별채권',          N'채권·채무',   N'["거래처명"]',                 NULL,   N'잔액'),
  (N'E040309', N'거래처별채무(채무현황)', N'채권·채무',   N'["거래처코드","거래처명"]',     NULL,   N'잔액'),
  (N'E010205', N'입/출금계좌 조회',      N'은행·카드·이체', N'["일자","계좌번호","거래처명"]', N'일자', N'금액'),
  (N'E040217', N'수금현황',              N'채권·채무',   N'["일자","거래처명"]',           N'일자', N'금액'),
  (N'E040310', N'지급현황',              N'채권·채무',   N'["일자","거래처명"]',           N'일자', N'금액'),
  (N'E040305', N'구매현황',              N'영업·구매',   N'["일자","거래처명","품목명"]', N'일자', N'합계'),
  (N'E010101', N'거래처등록',            N'기초정보',    N'["거래처코드"]',                NULL,   NULL),
  (N'E040103', N'품목등록',              N'기초정보',    N'["품목코드"]',                  NULL,   NULL),
  (N'E010847', N'회계거래현황',          N'회계·분개',   N'["일자","번호"]',               N'일자', N'금액'),
  (N'E010845', N'매출(세금)계산서현황',  N'전자증빙',    N'["일자","거래처명"]',           N'일자', N'합계'),
  (N'E010846', N'매입(세금)계산서현황',  N'전자증빙',    N'["일자","거래처명"]',           N'일자', N'합계'),
  (N'E010206', N'카드매입조회',          N'은행·카드·이체', N'["일자","카드번호"]',        N'일자', N'금액')
) AS v (PrgId, MenuName, Category, KeyColumnsJson, DateColumn, AmountColumn)
WHERE NOT EXISTS (SELECT 1 FROM ecount.Dataset d WHERE d.PrgId = v.PrgId);
GO
