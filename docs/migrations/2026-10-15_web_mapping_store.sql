-- Run only inside the explicit first-cutover transaction. Runtime APIs never run DDL.
IF OBJECT_ID(N'dbo.WebMappingStore', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebMappingStore (
    StoreKey NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    Payload NVARCHAR(MAX) NOT NULL,
    Revision INT NOT NULL,
    UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebMappingStore_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_WebMappingStore_Revision CHECK (Revision > 0),
    CONSTRAINT CK_WebMappingStore_Json CHECK (ISJSON(Payload) = 1)
  );
END;

IF OBJECT_ID(N'dbo.WebMappingMigration', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebMappingMigration (
    MigrationKey NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    SourceHashes NVARCHAR(MAX) NOT NULL,
    SourceCounts NVARCHAR(1000) NOT NULL,
    SemanticHashes NVARCHAR(MAX) NOT NULL,
    AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebMappingMigration_AppliedAt DEFAULT SYSUTCDATETIME()
  );
END;
