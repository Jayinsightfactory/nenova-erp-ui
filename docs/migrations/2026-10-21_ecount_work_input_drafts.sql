-- ecount_work 입력 초안(InputDraft) 테이블 — 웹 전용, 명시적 설치만 (사장님 SSMS 실행). 런타임 DDL 없음.
-- 대상 화면 7종: E040203 주문서입력 / E040205 판매입력 / E040253 판매입력 II / E040301 발주서입력
--               E040501 창고이동입력 / E040503 자가사용입력 / E040507 불량처리입력
-- ECOUNT 원본과 ERP 공유 원장(주문·출고·재고·입고 마스터/상세 테이블)은 읽기·쓰기 대상이 아니다.
-- 삭제는 소프트(Status='cancelled')만 허용하며 하드 DELETE 는 트리거로 차단한다. 라인·감사는 추가 전용(불변).
-- idempotent: 여러 번 실행해도 안전하다.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'ecount_work') IS NULL EXEC(N'CREATE SCHEMA ecount_work AUTHORIZATION dbo');

-- 1) 초안 헤더: 현재 상태 + 헤더 입력칸 안전투영(FieldsJson). 거래처명·담당자명 등 개인정보 없음(불투명 참조코드만).
IF OBJECT_ID(N'ecount_work.InputDraftHead',N'U') IS NULL
CREATE TABLE ecount_work.InputDraftHead (
 DraftId uniqueidentifier NOT NULL CONSTRAINT PK_EcountWorkInputDraftHead PRIMARY KEY,
 Program char(7) NOT NULL CONSTRAINT CK_EcountWorkInputDraftHead_Program CHECK(Program IN ('E040203','E040205','E040253','E040301','E040501','E040503','E040507')),
 Status varchar(10) NOT NULL CONSTRAINT CK_EcountWorkInputDraftHead_Status CHECK(Status IN ('draft','reviewed','cancelled')),
 Revision int NOT NULL CONSTRAINT CK_EcountWorkInputDraftHead_Revision CHECK(Revision>0),
 FieldsJson nvarchar(max) NOT NULL CONSTRAINT CK_EcountWorkInputDraftHead_FieldsJson CHECK(ISJSON(FieldsJson)=1),
 LineCount int NOT NULL CONSTRAINT CK_EcountWorkInputDraftHead_LineCount CHECK(LineCount BETWEEN 0 AND 200),
 CreatedBy char(64) NOT NULL,            -- sha256 actor hash (사용자 ID 평문 저장 금지)
 CreatedAt datetime2 NOT NULL CONSTRAINT DF_EcountWorkInputDraftHead_CreatedAt DEFAULT SYSUTCDATETIME(),
 UpdatedAt datetime2 NOT NULL CONSTRAINT DF_EcountWorkInputDraftHead_UpdatedAt DEFAULT SYSUTCDATETIME(),
 CancelledReason nvarchar(200) NULL,
 CONSTRAINT CK_EcountWorkInputDraftHead_Cancelled CHECK((Status='cancelled' AND CancelledReason IS NOT NULL AND LEN(CancelledReason)>0) OR (Status<>'cancelled' AND CancelledReason IS NULL)),
 CONSTRAINT CK_EcountWorkInputDraftHead_Updated CHECK(UpdatedAt>=CreatedAt)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_EcountWorkInputDraftHead_Program_Status' AND object_id=OBJECT_ID(N'ecount_work.InputDraftHead'))
CREATE INDEX IX_EcountWorkInputDraftHead_Program_Status ON ecount_work.InputDraftHead(Program,Status,UpdatedAt DESC);

-- 2) 초안 라인: revision 별 전체 라인 집합을 추가 전용으로 저장 (현재 라인 = Head.Revision 과 같은 Revision).
IF OBJECT_ID(N'ecount_work.InputDraftLine',N'U') IS NULL
CREATE TABLE ecount_work.InputDraftLine (
 DraftId uniqueidentifier NOT NULL,
 Revision int NOT NULL CONSTRAINT CK_EcountWorkInputDraftLine_Revision CHECK(Revision>0),
 LineNo int NOT NULL CONSTRAINT CK_EcountWorkInputDraftLine_LineNo CHECK(LineNo BETWEEN 1 AND 200),
 FieldsJson nvarchar(max) NOT NULL CONSTRAINT CK_EcountWorkInputDraftLine_FieldsJson CHECK(ISJSON(FieldsJson)=1),
 CreatedAt datetime2 NOT NULL CONSTRAINT DF_EcountWorkInputDraftLine_CreatedAt DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_EcountWorkInputDraftLine PRIMARY KEY(DraftId,Revision,LineNo),
 CONSTRAINT FK_EcountWorkInputDraftLine_Head FOREIGN KEY(DraftId) REFERENCES ecount_work.InputDraftHead(DraftId)
);

-- 3) 감사: 초안 revision 마다 1행 (create/correct/review/cancel) + 변경 diff. 추가 전용.
IF OBJECT_ID(N'ecount_work.InputDraftAudit',N'U') IS NULL
CREATE TABLE ecount_work.InputDraftAudit (
 AuditId bigint IDENTITY NOT NULL CONSTRAINT PK_EcountWorkInputDraftAudit PRIMARY KEY,
 DraftId uniqueidentifier NOT NULL,
 Revision int NOT NULL CONSTRAINT CK_EcountWorkInputDraftAudit_Revision CHECK(Revision>0),
 Action varchar(10) NOT NULL CONSTRAINT CK_EcountWorkInputDraftAudit_Action CHECK(Action IN ('create','correct','review','cancel')),
 Actor char(64) NOT NULL,                -- sha256 actor hash
 At datetime2 NOT NULL CONSTRAINT DF_EcountWorkInputDraftAudit_At DEFAULT SYSUTCDATETIME(),
 DiffJson nvarchar(max) NOT NULL CONSTRAINT CK_EcountWorkInputDraftAudit_DiffJson CHECK(ISJSON(DiffJson)=1),
 CONSTRAINT UQ_EcountWorkInputDraftAudit_Revision UNIQUE(DraftId,Revision),
 CONSTRAINT FK_EcountWorkInputDraftAudit_Head FOREIGN KEY(DraftId) REFERENCES ecount_work.InputDraftHead(DraftId)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_EcountWorkInputDraftAudit_At' AND object_id=OBJECT_ID(N'ecount_work.InputDraftAudit'))
CREATE INDEX IX_EcountWorkInputDraftAudit_At ON ecount_work.InputDraftAudit(At DESC);

-- 4) 불변·소프트삭제 규칙 (트리거)
--    Head: 하드 DELETE 금지, Program/CreatedBy/CreatedAt 변경 금지, 취소된 초안의 상태 되돌림 금지.
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.InputDraftHead_NoHardDelete ON ecount_work.InputDraftHead INSTEAD OF DELETE AS BEGIN THROW 51011, ''InputDraftHead hard delete forbidden: set Status=cancelled instead'', 1; END');
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.InputDraftHead_Guard ON ecount_work.InputDraftHead AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF UPDATE(Program) OR UPDATE(CreatedBy) OR UPDATE(CreatedAt) OR UPDATE(DraftId)
  THROW 51012, ''InputDraftHead identity columns are immutable'', 1;
 IF EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.DraftId=d.DraftId WHERE d.Status=''cancelled'' AND i.Status<>''cancelled'')
  THROW 51013, ''Cancelled InputDraft cannot be reopened; create a new draft'', 1;
 IF EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.DraftId=d.DraftId WHERE i.Revision<>d.Revision+1)
  THROW 51014, ''InputDraftHead.Revision must increase by exactly 1 per update'', 1;
END');
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.InputDraftLine_Immutable ON ecount_work.InputDraftLine INSTEAD OF UPDATE, DELETE AS BEGIN THROW 51015, ''Immutable InputDraftLine (append a new revision instead)'', 1; END');
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.InputDraftAudit_Immutable ON ecount_work.InputDraftAudit INSTEAD OF UPDATE, DELETE AS BEGIN THROW 51016, ''Immutable InputDraftAudit'', 1; END');

COMMIT;
