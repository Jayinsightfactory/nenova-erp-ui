import {randomUUID} from 'node:crypto';
import {previewInvoiceReceipt} from './invoiceReceiptWriter.js';

// Validation and its evidence are committed together. No receipt/stock writer is called.
export async function previewInvoiceWithAudit({withTransactionFn,types,documentId,revision,actor,previewFn=previewInvoiceReceipt}) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId||'')||!Number.isSafeInteger(revision)||revision<1)throw Object.assign(Error('문서와 버전을 확인하세요.'),{statusCode:400,code:'INVALID_SCOPE'});
  return withTransactionFn(async q=>{
    await q('SELECT DocumentId FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE DocumentId=@id',{id:{type:types.UniqueIdentifier,value:documentId}});
    const result=await previewFn({queryFn:q,types,documentId,revision});
    const event={schemaVersion:1,stage:'validation',status:result.canCommit?'passed':'blocked',code:result.canCommit?null:'VALIDATION_BLOCKED',eventId:randomUUID(),documentRevision:revision,
      evidence:{origin:'SERVER_VALIDATION',erpProof:false},issues:(result.issues||[]).map(i=>({code:i.code,message:i.message,lineId:i.lineId??null,lineNo:i.lineNo??null}))};
    await q(`INSERT INTO dbo.WebInvoiceHistory (DocumentId,Revision,OperationId,Action,BeforeJson,AfterJson,Reason,Actor,CreatedAt) VALUES (@id,@revision,NULL,N'WORKFLOW_STAGE',NULL,@event,NULL,@actor,SYSUTCDATETIME())`,{
      id:{type:types.UniqueIdentifier,value:documentId},revision:{type:types.Int,value:revision},event:{type:types.NVarChar(types.MAX),value:JSON.stringify(event)},actor:{type:types.NVarChar(200),value:actor}
    });
    return {...result,validationLogSaved:true};
  });
}
