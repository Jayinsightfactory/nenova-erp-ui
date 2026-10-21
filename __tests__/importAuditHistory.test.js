import test from 'node:test';
import './invoiceUploadIssue.test.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {productHistoryChanges,historyValue,appendProductInputHistory} from '../lib/productInputHistory.js';
import {createInvoiceReceiptStageLogClient,currentInvoiceStageHistory,invoiceStageHistorySummary} from '../lib/invoiceReceiptStageLogClient.js';
import {previewInvoiceWithAudit} from '../lib/invoiceValidationAudit.js';
test('product history preserves blank/zero, percentage and before/after identity',async()=>{
 assert.deepEqual(productHistoryChanges({BoxWeight:null},{BoxWeight:0}),[{key:'BoxWeight',label:'박스무게',before:null,after:0}]);
 assert.equal(historyValue('TariffRate',.25),'25%');assert.equal(historyValue('BoxWeight',null),'빈칸');
 let saved;await appendProductInputHistory(async(s,p)=>{saved={s,p};},{NVarChar:()=>'',MAX:0},'tester',{BoxWeight:null},{ProdKey:12,ProdName:'fixture',BoxWeight:0});
 assert.match(saved.s,/INSERT INTO SystemActionLog/);assert.doesNotMatch(saved.s,/UPDATE|Warehouse|Shipment|Stock/);
 assert.equal(JSON.parse(saved.p.payload.value).changes[0].after.BoxWeight,0);
});
test('pending logs survive reload, stay user-scoped and retry only audit with same IDs',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const doc={documentId:randomUUID(),revision:1,sourceHash:'a'.repeat(64)};
 const first=createInvoiceReceiptStageLogClient({uuid:randomUUID,fetchFn:async()=>{throw Error('offline');}});first.restore(storage,'A');first.enqueue(doc,{id:'validation',status:'blocked'});await first.flush();
 const calls=[];const restored=createInvoiceReceiptStageLogClient({uuid:randomUUID,fetchFn:async(url,opts)=>{calls.push({url,p:JSON.parse(opts.body)});return {ok:true,json:async()=>({success:true})};}});restored.restore(storage,'A');
 assert.equal(restored.snapshot().pending.length,1);assert.equal(calls.length,0);await restored.retry();assert.equal(calls[0].p.eventId,first.snapshot().pending[0].payload.eventId);assert.match(calls[0].url,/stage-events$/);
 const other=createInvoiceReceiptStageLogClient();other.restore(storage,'B');assert.equal(other.snapshot().pending.length,0);
});
test('prior revisions remain opt-in and problem codes have actionable Korean labels',()=>{
 const doc={revision:2,sourceHash:'b'.repeat(64),history:[{historyId:1,revision:1,after:{stage:'validation',status:'blocked',code:'VALIDATION_BLOCKED'}}]};
 assert.equal(currentInvoiceStageHistory(doc).length,0);const all=currentInvoiceStageHistory(doc,[],true);assert.equal(all.length,1);assert.match(invoiceStageHistorySummary(all[0]).reason,/품목 매칭/);
});
test('server validation evidence is mandatory, audit failure rejects preview, cross-year scope retained',async()=>{
 for(const year of ['2025','2026']){
 const writes=[];const preview={canCommit:false,documentRevision:1,orderYear:year,orderWeek:'41-02',issues:[{code:'PRODUCT_REQUIRED',message:'품목 지정 필요',lineId:'line-a',lineNo:2}]};
 const result=await previewInvoiceWithAudit({withTransactionFn:fn=>fn(async(s,p)=>{writes.push({s,p});return {recordset:[]};}),types:{UniqueIdentifier:0,Int:0,NVarChar:()=>0,MAX:0},documentId:randomUUID(),revision:1,actor:'tester',previewFn:async()=>preview});
 assert.equal(result.orderYear,year);assert.equal(result.validationLogSaved,true);const event=JSON.parse(writes[1].p.event.value);assert.equal(event.issues[0].lineNo,2);assert.equal(event.evidence.erpProof,false);assert.doesNotMatch(writes.map(x=>x.s).join('\n'),/UPDATE|DELETE|usp_|Warehouse|Stock/);
 }
 await assert.rejects(previewInvoiceWithAudit({withTransactionFn:fn=>fn(async(s)=>{if(s.includes('INSERT'))throw Error('audit unavailable');return {}; }),types:{UniqueIdentifier:0,Int:0,NVarChar:()=>0},documentId:randomUUID(),revision:1,actor:'tester',previewFn:async()=>({canCommit:false,issues:[]})}),/audit unavailable/);
});
