import {getInvoiceDocument} from './invoiceReceiptDocuments.js';
import {buildReceiptLines} from './invoiceReceiptCost.js';
import references from '../data/cloud-cost-reference-evidence.json' with {type:'json'};

// Historical committed source is comparison evidence, never proof that today's
// ledger still equals that source. Current cost guards remain independent.
export async function readCloudReviewSource({queryFn,types,source}){
 const result=await queryFn(`/* invoice-expenses:review-source */ SELECT DISTINCT d.DocumentId
 FROM dbo.WebInvoiceDocument d JOIN dbo.WebInvoiceOperation o ON o.DocumentId=d.DocumentId
 WHERE o.WarehouseKey=@warehouseKey AND o.Status=N'COMMITTED' AND d.ReceiptStatus=N'COMMITTED'
 AND o.DocumentRevision=d.Revision`,{warehouseKey:{type:types.Int,value:source.warehouseKey}});
 if(!Array.isArray(result.recordset)||result.recordset.length!==1)return null;
 const document=await getInvoiceDocument({queryFn,types,documentId:String(result.recordset[0].DocumentId)});
 if(!document||document.orderYear!==source.orderYear||document.orderWeek!==source.orderWeek||document.invoiceNo!==source.invoiceNo)return null;
 const operations=document.operations.filter(o=>o.status==='COMMITTED'&&o.documentRevision===document.revision&&o.warehouseKey===source.warehouseKey);
 if(operations.length!==1)return null;
 const lines=buildReceiptLines(document,operations[0]);
 if(lines.length!==source.lines.length||new Set(lines.map(l=>l.wdetailKey)).size!==lines.length||lines.some(l=>!source.lines.some(r=>r.wdetailKey===l.wdetailKey)))return null;
 const reference=references.records.find(e=>e.scope.warehouseKey===source.warehouseKey&&e.scope.orderYear===source.orderYear&&e.scope.orderWeek===source.orderWeek&&e.scope.invoiceNo===source.invoiceNo&&e.scope.farmName===source.farmName&&e.scope.fileName===document.originalFileName&&e.rowCount===lines.length&&e.invoiceSource?.sha256===document.sourceHash);
 return {documentId:document.documentId,revision:document.revision,fileName:document.originalFileName,sourceHash:document.sourceHash,
  reference:reference?{...reference,association:'HISTORICAL_COMPARISON_ONLY'}:null,
  lines:lines.map(l=>({wdetailKey:l.wdetailKey,originalName:l.originalName,prodKey:l.prodKey,quantity:l.outQuantity,unit:l.outUnit,currency:l.currency,unitPrice:l.unitPrice,amount:l.lineAmount,specification:l.lengthText??'',sourceEvidence:l.sourceEvidence}))};
}
