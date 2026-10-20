-- Explicit installation only. No ECOUNT or existing ERP records are changed.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF SCHEMA_ID(N'ecount_work') IS NULL EXEC(N'CREATE SCHEMA ecount_work AUTHORIZATION dbo');
IF OBJECT_ID(N'ecount_work.Version',N'U') IS NULL
CREATE TABLE ecount_work.Version (
 VersionId uniqueidentifier NOT NULL PRIMARY KEY,
 RootKey varchar(32) NOT NULL CHECK(RootKey='nenova-ecount'),
 MenuId nvarchar(100) NOT NULL, Program varchar(30) NOT NULL, Dataset varchar(10) NOT NULL,
 ContentHash char(64) NOT NULL, PeriodFrom char(10) NULL, PeriodTo char(10) NULL,
 Completeness varchar(10) NOT NULL CHECK(Completeness='unknown'),
 [RowCount] int NOT NULL CHECK([RowCount] BETWEEN 0 AND 20000), RowsJson nvarchar(max) NOT NULL CHECK(ISJSON(RowsJson)=1),
 SourceKind varchar(20) NOT NULL CHECK(SourceKind IN ('upload','existing-snapshot')),
 SourceSnapshotKey int NULL, SourceTakenAt datetime2 NULL, ActorHash char(64) NOT NULL,
 CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_EcountWorkVersion_Hash UNIQUE(RootKey,MenuId,Program,Dataset,ContentHash),
 CONSTRAINT UQ_EcountWorkVersion_Scope UNIQUE(RootKey,MenuId,Program,Dataset,VersionId),
 CONSTRAINT CK_EcountWorkVersion_Period CHECK((PeriodFrom IS NULL AND PeriodTo IS NULL) OR (PeriodFrom IS NOT NULL AND PeriodTo IS NOT NULL AND PeriodFrom<=PeriodTo))
);
IF COL_LENGTH(N'ecount_work.Version',N'SourceTakenAt') IS NULL
ALTER TABLE ecount_work.Version ADD SourceTakenAt datetime2 NULL;
IF OBJECT_ID(N'ecount_work.Head',N'U') IS NULL
CREATE TABLE ecount_work.Head (
 RootKey varchar(32) NOT NULL CHECK(RootKey='nenova-ecount'), MenuId nvarchar(100) NOT NULL,
 Program varchar(30) NOT NULL, Dataset varchar(10) NOT NULL,
 VersionId uniqueidentifier NOT NULL, Revision int NOT NULL CHECK(Revision>0),
 PRIMARY KEY(RootKey,MenuId,Program,Dataset),
 FOREIGN KEY(RootKey,MenuId,Program,Dataset,VersionId) REFERENCES ecount_work.Version(RootKey,MenuId,Program,Dataset,VersionId)
);
IF OBJECT_ID(N'ecount_work.Audit',N'U') IS NULL
CREATE TABLE ecount_work.Audit (
 EventId bigint IDENTITY PRIMARY KEY, RootKey varchar(32) NOT NULL CHECK(RootKey='nenova-ecount'),
 MenuId nvarchar(100) NOT NULL, Program varchar(30) NOT NULL, Dataset varchar(10) NOT NULL,
 Revision int NOT NULL, PreviousVersionId uniqueidentifier NULL, VersionId uniqueidentifier NOT NULL,
 Action varchar(20) NOT NULL CHECK(Action IN ('import','import-latest','activate')),
 ReasonCode varchar(20) NOT NULL CHECK(ReasonCode IN ('IMPORT','CORRECTION','ROLLBACK')),
 ActorHash char(64) NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UNIQUE(RootKey,MenuId,Program,Dataset,Revision),
 FOREIGN KEY(RootKey,MenuId,Program,Dataset,VersionId) REFERENCES ecount_work.Version(RootKey,MenuId,Program,Dataset,VersionId)
);
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.Version_Immutable ON ecount_work.Version INSTEAD OF UPDATE, DELETE AS BEGIN THROW 51001, ''Immutable ECOUNT workspace version'', 1; END');
EXEC(N'CREATE OR ALTER TRIGGER ecount_work.Audit_Immutable ON ecount_work.Audit INSTEAD OF UPDATE, DELETE AS BEGIN THROW 51002, ''Immutable ECOUNT workspace audit'', 1; END');
COMMIT;
