SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebChinaVolumeBoard', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebChinaVolumeBoard (
    BoardKey BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebChinaVolumeBoard PRIMARY KEY,
    OrderYear CHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    BoardName NVARCHAR(120) NOT NULL,
    SourceFileName NVARCHAR(260) NULL,
    SourceSheetName NVARCHAR(200) NULL,
    PackingRowsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_Packing DEFAULT N'[]',
    CellsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_Cells DEFAULT N'{}',
    MatchOverridesJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_Matches DEFAULT N'{}',
    ReviewStateJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_Review DEFAULT N'{}',
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_UpdatedAt DEFAULT SYSDATETIME(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebChinaVolumeBoard_Deleted DEFAULT 0,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT CK_WebChinaVolumeBoard_PackingJson CHECK (ISJSON(PackingRowsJson)=1),
    CONSTRAINT CK_WebChinaVolumeBoard_CellsJson CHECK (ISJSON(CellsJson)=1),
    CONSTRAINT CK_WebChinaVolumeBoard_MatchesJson CHECK (ISJSON(MatchOverridesJson)=1),
    CONSTRAINT CK_WebChinaVolumeBoard_ReviewJson CHECK (ISJSON(ReviewStateJson)=1)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id=OBJECT_ID(N'dbo.WebChinaVolumeBoard', N'U')
     AND name=N'IX_WebChinaVolumeBoard_Scope'
)
BEGIN
  CREATE INDEX IX_WebChinaVolumeBoard_Scope
    ON dbo.WebChinaVolumeBoard(OrderYear, OrderWeek, isDeleted, UpdatedAt DESC);
END;

IF OBJECT_ID(N'dbo.WebChinaVolumeProductMap', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebChinaVolumeProductMap (
    MapKey BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebChinaVolumeProductMap PRIMARY KEY,
    NormalizedSourceName NVARCHAR(220) NOT NULL,
    SourceItemName NVARCHAR(300) NOT NULL,
    ProdKey INT NOT NULL,
    ProdNameSnapshot NVARCHAR(300) NOT NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebChinaVolumeProductMap_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WebChinaVolumeProductMap_UpdatedAt DEFAULT SYSDATETIME(),
    isDeleted BIT NOT NULL CONSTRAINT DF_WebChinaVolumeProductMap_Deleted DEFAULT 0,
    RowVersion ROWVERSION NOT NULL
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE object_id=OBJECT_ID(N'dbo.WebChinaVolumeProductMap', N'U')
     AND name=N'UX_WebChinaVolumeProductMap_ActiveNormalized'
)
BEGIN
  CREATE UNIQUE INDEX UX_WebChinaVolumeProductMap_ActiveNormalized
    ON dbo.WebChinaVolumeProductMap(NormalizedSourceName)
    WHERE isDeleted=0;
END;

COMMIT TRANSACTION;
