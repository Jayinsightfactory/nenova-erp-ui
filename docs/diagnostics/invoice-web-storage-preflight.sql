-- Read-only preflight for the approved six empty web-only tables.
SELECT DB_NAME() AS DatabaseName, @@TRANCOUNT AS TranCount,
 HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CREATE TABLE') AS CanCreateTable,
 HAS_PERMS_BY_NAME('dbo','SCHEMA','ALTER') AS CanAlterDbo;
SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME();
SELECT name,type_desc FROM sys.objects WHERE schema_id=SCHEMA_ID(N'dbo')
 AND name IN (N'WebInvoiceDocument',N'WebInvoiceLine',N'WebInvoiceOperation',
 N'WebInvoiceHistory',N'WebInvoiceCostRevision',N'WebInvoiceCostLine');
SELECT name,is_disabled,OBJECT_DEFINITION(object_id) AS TriggerDefinition
 FROM sys.triggers WHERE parent_class=0;
SELECT name,CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(object_id)),2) AS DefinitionHash
 FROM sys.objects WHERE name IN (N'usp_CreateWarehouse',N'usp_GetNextKey',
 N'usp_StockCalculation',N'usp_NenovaStockWeekGateEnter',N'usp_NenovaStockWeekGateLeave') ORDER BY name;
SELECT COUNT_BIG(*) AS StagingRows,CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS StagingChecksum
 FROM dbo.TempWarehouseDetail;
