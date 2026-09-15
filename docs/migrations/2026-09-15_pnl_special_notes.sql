-- Partner/year P&L notes. Web-only metadata: no ERP ledger side effects.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.WebRaumPnlSpecialNote', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebRaumPnlSpecialNote (
    PartnerCode NVARCHAR(20) NOT NULL,
    OrderYear CHAR(4) NOT NULL,
    NoteText NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebRaumPnlSpecialNote_NoteText DEFAULT (N''),
    Revision UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_WebRaumPnlSpecialNote_Revision DEFAULT (NEWID()),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebRaumPnlSpecialNote_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedBy NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_WebRaumPnlSpecialNote PRIMARY KEY (PartnerCode, OrderYear),
    CONSTRAINT CK_WebRaumPnlSpecialNote_OrderYear CHECK (OrderYear LIKE '[2][0-9][0-9][0-9]')
  );
END;

IF COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'PartnerCode') IS NULL
   OR COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'OrderYear') IS NULL
   OR COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'NoteText') IS NULL
   OR COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'Revision') IS NULL
   OR COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'UpdatedAt') IS NULL
   OR COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'UpdatedBy') IS NULL
  THROW 50011, 'WebRaumPnlSpecialNote schema does not match the P&L note migration.', 1;

COMMIT;
