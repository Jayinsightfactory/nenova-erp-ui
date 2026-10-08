-- SELECT only. Run after the approved create-only migration in nenova1_nenova.
SELECT DB_NAME() AS DatabaseName, @@TRANCOUNT AS TranCount;
SELECT N'WebInvoiceDocument' AS TableName,COUNT_BIG(*) AS [RowCount] FROM dbo.WebInvoiceDocument
UNION ALL SELECT N'WebInvoiceLine',COUNT_BIG(*) FROM dbo.WebInvoiceLine
UNION ALL SELECT N'WebInvoiceOperation',COUNT_BIG(*) FROM dbo.WebInvoiceOperation
UNION ALL SELECT N'WebInvoiceHistory',COUNT_BIG(*) FROM dbo.WebInvoiceHistory
UNION ALL SELECT N'WebInvoiceCostRevision',COUNT_BIG(*) FROM dbo.WebInvoiceCostRevision
UNION ALL SELECT N'WebInvoiceCostLine',COUNT_BIG(*) FROM dbo.WebInvoiceCostLine;
SELECT o.name,CONVERT(varchar(64),HASHBYTES('SHA2_256',m.definition),2) AS DefinitionHash
FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE o.name IN (N'usp_CreateWarehouse',N'usp_GetNextKey',N'usp_StockCalculation',
 N'usp_NenovaStockWeekGateEnter',N'usp_NenovaStockWeekGateLeave') ORDER BY o.name;
SELECT COUNT_BIG(*) AS StagingRows,CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS StagingChecksum
FROM dbo.TempWarehouseDetail;
SELECT OBJECT_NAME(fk.parent_object_id) AS TableName,fk.name,
 OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
 fk.is_disabled,fk.is_not_trusted,fk.delete_referential_action_desc
FROM sys.foreign_keys fk
WHERE OBJECT_NAME(fk.parent_object_id) IN (N'WebInvoiceDocument',N'WebInvoiceLine',
 N'WebInvoiceOperation',N'WebInvoiceHistory',N'WebInvoiceCostRevision',N'WebInvoiceCostLine');
SELECT COUNT(*) AS CheckCount,
 SUM(CASE WHEN c.is_disabled=0 AND c.is_not_trusted=0
  AND TRY_CONVERT(varbinary(32),ep.value)=HASHBYTES('SHA2_256',c.definition) THEN 1 ELSE 0 END) AS VerifiedCheckCount
FROM sys.check_constraints c
JOIN sys.tables t ON t.object_id=c.parent_object_id
LEFT JOIN sys.extended_properties ep ON ep.class=1 AND ep.major_id=c.object_id
 AND ep.minor_id=0 AND ep.name=N'NenovaWebInvoiceV1CheckHash'
WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN (N'WebInvoiceDocument',N'WebInvoiceLine',
 N'WebInvoiceOperation',N'WebInvoiceHistory',N'WebInvoiceCostRevision',N'WebInvoiceCostLine');
