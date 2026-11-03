-- bank 스키마: 은행 빠른조회 원본 거래내역 적재. dbo/ecount 는 건드리지 않는다. 멱등(SQL Server 2016). 배치 구분은 GO.
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'bank') EXEC (N'CREATE SCHEMA bank');
GO
IF OBJECT_ID(N'bank.Account', N'U') IS NULL
BEGIN
  CREATE TABLE bank.Account (
    AccountKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bank_Account PRIMARY KEY,
    Bank NVARCHAR(20) NOT NULL,
    Alias NVARCHAR(60) NOT NULL,
    AccountNoMasked NVARCHAR(30) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_bank_Account_Active DEFAULT 1,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_bank_Account_Created DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_bank_Account_Alias UNIQUE (Alias)
  );
END
GO
IF OBJECT_ID(N'bank.LoadBatch', N'U') IS NULL
BEGIN
  CREATE TABLE bank.LoadBatch (
    BatchKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bank_LoadBatch PRIMARY KEY,
    AccountKey INT NOT NULL CONSTRAINT FK_bank_LoadBatch_Account REFERENCES bank.Account(AccountKey),
    PeriodFrom DATE NULL,
    PeriodTo DATE NULL,
    Source NVARCHAR(40) NOT NULL,
    RowCnt INT NOT NULL CONSTRAINT DF_bank_LoadBatch_Row DEFAULT 0,
    LoadedAt DATETIME2(0) NOT NULL CONSTRAINT DF_bank_LoadBatch_At DEFAULT SYSDATETIME(),
    Note NVARCHAR(400) NULL
  );
END
GO
IF OBJECT_ID(N'bank.Txn', N'U') IS NULL
BEGIN
  CREATE TABLE bank.Txn (
    TxnKey BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bank_Txn PRIMARY KEY,
    AccountKey INT NOT NULL CONSTRAINT FK_bank_Txn_Account REFERENCES bank.Account(AccountKey),
    BatchKey INT NOT NULL CONSTRAINT FK_bank_Txn_Batch REFERENCES bank.LoadBatch(BatchKey),
    TxnDate DATE NOT NULL,
    TxnTime NVARCHAR(8) NULL,
    Type NVARCHAR(12) NOT NULL CONSTRAINT CK_bank_Txn_Type CHECK (Type IN (N'deposit', N'withdrawal')),
    Amount DECIMAL(18,2) NOT NULL,
    Balance DECIMAL(18,2) NULL,
    Description NVARCHAR(200) NULL,
    DisplayName NVARCHAR(100) NULL,
    Counterparty NVARCHAR(100) NULL,
    Branch NVARCHAR(60) NULL,
    Memo NVARCHAR(200) NULL,
    RawJson NVARCHAR(MAX) NULL,
    RowHash CHAR(64) NOT NULL,
    CONSTRAINT UQ_bank_Txn_Hash UNIQUE (AccountKey, RowHash)
  );
  CREATE INDEX IX_bank_Txn_Date ON bank.Txn (AccountKey, TxnDate);
END
GO
