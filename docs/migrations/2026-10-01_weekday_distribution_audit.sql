SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebWeekdayDistributionOperation', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WebWeekdayDistributionOperation
    (
        UUID uniqueidentifier NOT NULL,
        RequestHash char(64) NOT NULL,
        [User] nvarchar(128) NOT NULL,
        Reason nvarchar(1000) NOT NULL,
        ResponseJson nvarchar(max) NULL,
        Created datetime2(3) NOT NULL
            CONSTRAINT DF_WebWeekdayDistributionOperation_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_WebWeekdayDistributionOperation PRIMARY KEY CLUSTERED (UUID),
        CONSTRAINT CK_WebWeekdayDistributionOperation_RequestHash
            CHECK (LEN(RequestHash) = 64)
    );
END;

IF OBJECT_ID(N'dbo.WebWeekdayDistributionChange', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WebWeekdayDistributionChange
    (
        OperationFK uniqueidentifier NOT NULL,
        [Year] char(4) NOT NULL,
        [Week] varchar(5) NOT NULL,
        CustKey int NOT NULL,
        ProdKey int NOT NULL,
        BeforeJson nvarchar(max) NOT NULL,
        AfterJson nvarchar(max) NOT NULL,
        StockValuesIfKnown nvarchar(max) NULL,
        CONSTRAINT PK_WebWeekdayDistributionChange
            PRIMARY KEY CLUSTERED (OperationFK, [Year], [Week], CustKey, ProdKey),
        CONSTRAINT FK_WebWeekdayDistributionChange_Operation
            FOREIGN KEY (OperationFK)
            REFERENCES dbo.WebWeekdayDistributionOperation(UUID),
        CONSTRAINT CK_WebWeekdayDistributionChange_Year
            CHECK ([Year] LIKE '[2-9][0-9][0-9][0-9]'),
        CONSTRAINT CK_WebWeekdayDistributionChange_Week
            CHECK ([Week] LIKE '[0-9][0-9]-0[1-3]'),
        CONSTRAINT CK_WebWeekdayDistributionChange_CustKey CHECK (CustKey > 0),
        CONSTRAINT CK_WebWeekdayDistributionChange_ProdKey CHECK (ProdKey > 0),
        CONSTRAINT CK_WebWeekdayDistributionChange_BeforeJson CHECK (ISJSON(BeforeJson) = 1),
        CONSTRAINT CK_WebWeekdayDistributionChange_AfterJson CHECK (ISJSON(AfterJson) = 1),
        CONSTRAINT CK_WebWeekdayDistributionChange_StockJson
            CHECK (StockValuesIfKnown IS NULL OR ISJSON(StockValuesIfKnown) = 1)
    );
END;

IF OBJECT_ID(N'dbo.WebWeekdayDistributionChange', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
        WHERE object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionChange')
          AND name=N'IX_WebWeekdayDistributionChange_Scope'
   )
BEGIN
    CREATE INDEX IX_WebWeekdayDistributionChange_Scope
        ON dbo.WebWeekdayDistributionChange([Year], [Week], CustKey, ProdKey)
        INCLUDE (OperationFK);
END;

COMMIT TRANSACTION;
