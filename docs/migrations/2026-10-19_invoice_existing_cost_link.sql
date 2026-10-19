-- Web-only operation vocabulary. No native ERP table or stored procedure writes.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @definition nvarchar(max)=(SELECT definition FROM sys.check_constraints
 WHERE parent_object_id=OBJECT_ID(N'dbo.WebInvoiceOperation') AND name=N'CK_WebInvoiceOperation_Action');
IF @definition IS NULL THROW 51072,N'WEB_INVOICE_SCHEMA_REQUIRED',1;
IF @definition NOT LIKE N'%LINK_EXISTING_COST%'
BEGIN
 IF @definition<>N'([Action]=N''CREATE_RECEIPT'' OR [Action]=N''UPDATE_RECEIPT'')'
   THROW 51073,N'UNEXPECTED_OPERATION_CHECK',1;
 ALTER TABLE dbo.WebInvoiceOperation DROP CONSTRAINT CK_WebInvoiceOperation_Action;
 ALTER TABLE dbo.WebInvoiceOperation WITH CHECK ADD CONSTRAINT CK_WebInvoiceOperation_Action
 CHECK (Action IN (N'CREATE_RECEIPT',N'UPDATE_RECEIPT',N'LINK_EXISTING_COST'));
 DECLARE @fingerprint varbinary(32)=(SELECT HASHBYTES('SHA2_256',CONVERT(nvarchar(max),definition))
 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebInvoiceOperation') AND name=N'CK_WebInvoiceOperation_Action');
 EXEC sys.sp_addextendedproperty @name=N'NenovaWebInvoiceV1CheckHash',@value=@fingerprint,
 @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'WebInvoiceOperation',
 @level2type=N'CONSTRAINT',@level2name=N'CK_WebInvoiceOperation_Action';
END;
COMMIT;
