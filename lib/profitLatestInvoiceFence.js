import {query,sql} from './db.js';
// Revisions/lines are financial inputs too; the legacy ERP fingerprint predates them.
export const PROFIT_LATEST_INVOICE_FENCE_SQL=`SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',(
  SELECT r.CostRevisionId,r.DocumentId,r.DocumentRevision,r.OperationId,r.WarehouseKey,r.RevisionNo,r.Basis,r.Status,r.Currency,
    r.FormulaId,r.FormulaVersion,r.FormulaSourceHash,r.InputSnapshotJson,r.ApprovedAt,
    d.Revision,d.CostStatus,d.OrderYear,d.OrderWeek,d.FarmKey,d.ReviewedMetadataJson,
    o.Status OperationStatus,o.DocumentRevision OperationDocumentRevision,o.CompletedAt,
    l.LineId,l.WdetailKey,l.ProdKey,l.Unit,l.Quantity,l.CostPerUnit,l.TotalCost,l.ComponentAmountsJson
  FROM dbo.WebInvoiceCostRevision r JOIN dbo.WebInvoiceDocument d ON d.DocumentId=r.DocumentId
  LEFT JOIN dbo.WebInvoiceOperation o ON o.OperationId=r.OperationId
  LEFT JOIN dbo.WebInvoiceCostLine l ON l.CostRevisionId=r.CostRevisionId
  WHERE d.OrderYear IN (SELECT value FROM OPENJSON(@years))
  ORDER BY r.CostRevisionId,l.LineId FOR JSON PATH,INCLUDE_NULL_VALUES
)),2) digest`;
export async function latestProfitInvoiceFence(years,{queryFn=query,types=sql}={}){
 const ready=await queryFn(`SELECT COUNT(*) tableCount FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo')
   AND name IN (N'WebInvoiceCostRevision',N'WebInvoiceCostLine',N'WebInvoiceDocument',N'WebInvoiceOperation')`);
 const count=Number(ready.recordset?.[0]?.tableCount);
 if(count===0)return 'invoice-schema-absent';
 if(count!==4)throw Object.assign(new Error('인보이스 원가 조회 스키마가 불완전합니다.'),{code:'PROFIT_INVOICE_FENCE_INCOMPLETE',statusCode:409});
 const result=await queryFn(PROFIT_LATEST_INVOICE_FENCE_SQL,{years:{type:types.NVarChar(types.MAX),value:JSON.stringify([...new Set(years.map(String))].sort())}});
 const digest=result.recordset?.[0]?.digest;
 if(!/^[a-f\d]{64}$/i.test(String(digest)))throw Object.assign(new Error('인보이스 원가 지문을 확인하지 못했습니다.'),{code:'PROFIT_INVOICE_FENCE_INCOMPLETE',statusCode:409});
 return digest;
}
