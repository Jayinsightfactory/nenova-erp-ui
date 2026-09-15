-- Web P&L custom hotel registry.  This does not create Customer rows and does
-- not touch the shared order, shipment, stock, estimate, or profit ledgers.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebPnlHotel', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebPnlHotel (
    PartnerCode NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(80) NOT NULL,
    -- JS NFKC/whitespace canonical text is the identity.  BIN2 prevents a
    -- database default collation from treating two distinct canonical names
    -- (for example accent/kana variants) as the same unique key.
    NormalizedName NVARCHAR(80) COLLATE Latin1_General_100_BIN2 NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_WebPnlHotel_IsActive DEFAULT (1),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebPnlHotel_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CreatedBy NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_WebPnlHotel PRIMARY KEY (PartnerCode),
    CONSTRAINT UQ_WebPnlHotel_NormalizedName UNIQUE (NormalizedName),
    CONSTRAINT CK_WebPnlHotel_Code CHECK (PartnerCode LIKE N'hotel[_][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
  );
END;

-- This migration expects a new table.  If a hand-created table is already
-- present, fail closed instead of silently using a non-canonical registry.
IF COL_LENGTH(N'dbo.WebPnlHotel', N'PartnerCode') IS NULL
   OR COL_LENGTH(N'dbo.WebPnlHotel', N'Name') IS NULL
   OR COL_LENGTH(N'dbo.WebPnlHotel', N'NormalizedName') IS NULL
   OR COL_LENGTH(N'dbo.WebPnlHotel', N'IsActive') IS NULL
   OR COL_LENGTH(N'dbo.WebPnlHotel', N'CreatedAt') IS NULL
   OR COL_LENGTH(N'dbo.WebPnlHotel', N'CreatedBy') IS NULL
  THROW 50001, 'WebPnlHotel schema does not match the P&L hotel migration.', 1;

IF NOT EXISTS (
  SELECT 1
    FROM sys.indexes AS i
    INNER JOIN sys.index_columns AS ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    INNER JOIN sys.columns AS c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE i.object_id = OBJECT_ID(N'dbo.WebPnlHotel', N'U')
     AND i.name = N'UQ_WebPnlHotel_NormalizedName'
     AND i.is_unique = 1
     AND ic.key_ordinal = 1
     AND c.name = N'NormalizedName'
     AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns AS extra
        WHERE extra.object_id=i.object_id AND extra.index_id=i.index_id AND extra.key_ordinal > 1
     )
)
  THROW 50002, 'WebPnlHotel requires the NormalizedName unique key.', 1;

IF NOT EXISTS (
  SELECT 1
    FROM sys.columns AS c
   WHERE c.object_id = OBJECT_ID(N'dbo.WebPnlHotel', N'U')
     AND c.name = N'NormalizedName'
     AND c.collation_name = N'Latin1_General_100_BIN2'
)
  THROW 50003, 'WebPnlHotel NormalizedName requires Latin1_General_100_BIN2.', 1;

COMMIT;
