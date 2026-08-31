-- 출고분배 엑셀 업로드 전체 되돌리기용 불변 스냅샷 원장
-- 적용 전 DB 백업 및 운영 변경창 확인 필수.

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ShipmentImportAudit', N'U') IS NULL
  THROW 51000, N'ShipmentImportAudit 원장이 없어 스냅샷 스키마를 적용할 수 없습니다.', 1;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ShipmentImportSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ShipmentImportSnapshot (
    SnapshotKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    AuditKey INT NOT NULL,
    CustKey INT NULL,
    ProdKey INT NULL,
    EntityType NVARCHAR(30) NOT NULL,
    EntityKey INT NOT NULL,
    CreatedByBatch BIT NOT NULL CONSTRAINT DF_ShipmentImportSnapshot_Created DEFAULT 0,
    ChangeKind NVARCHAR(20) NOT NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NULL,
    CreatedDtm DATETIME NOT NULL CONSTRAINT DF_ShipmentImportSnapshot_CreatedDtm DEFAULT GETDATE(),
    CONSTRAINT CK_ShipmentImportSnapshot_EntityType CHECK
      (EntityType IN (N'OrderMaster',N'OrderDetail',N'ShipmentMaster',N'ShipmentDetail',N'ShipmentDate',N'ShipmentFarm')),
    CONSTRAINT CK_ShipmentImportSnapshot_ChangeKind CHECK
      (ChangeKind IN (N'CREATED',N'UPDATED',N'DELETED'))
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE name=N'IX_ShipmentImportSnapshot_AuditKey'
     AND object_id=OBJECT_ID(N'dbo.ShipmentImportSnapshot')
)
  CREATE INDEX IX_ShipmentImportSnapshot_AuditKey
    ON dbo.ShipmentImportSnapshot(AuditKey, SnapshotKey);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE name=N'IX_ShipmentImportSnapshot_Entity'
     AND object_id=OBJECT_ID(N'dbo.ShipmentImportSnapshot')
)
  CREATE INDEX IX_ShipmentImportSnapshot_Entity
    ON dbo.ShipmentImportSnapshot(EntityType, EntityKey, AuditKey);

IF COL_LENGTH('dbo.ShipmentImportAudit','RollbackStatus') IS NULL
  ALTER TABLE dbo.ShipmentImportAudit ADD RollbackStatus NVARCHAR(20) NOT NULL
    CONSTRAINT DF_ShipmentImportAudit_RollbackStatus DEFAULT N'NONE';
IF COL_LENGTH('dbo.ShipmentImportAudit','RolledBackDtm') IS NULL
  ALTER TABLE dbo.ShipmentImportAudit ADD RolledBackDtm DATETIME NULL;
IF COL_LENGTH('dbo.ShipmentImportAudit','RolledBackBy') IS NULL
  ALTER TABLE dbo.ShipmentImportAudit ADD RolledBackBy NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.ShipmentImportAudit','RollbackReason') IS NULL
  ALTER TABLE dbo.ShipmentImportAudit ADD RollbackReason NVARCHAR(500) NULL;

COMMIT TRANSACTION;
