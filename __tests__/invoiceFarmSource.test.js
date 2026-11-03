import test from 'node:test';
import assert from 'node:assert/strict';
import {hasReceiptFarmSource,readReceiptFarmSource,listInvoiceFarmSources} from '../lib/invoiceFarmSource.js';
import {resolveInvoiceHeader,applyInvoiceHeader} from '../lib/invoiceReceiptAutoFill.js';
import {uploadFailureDetail,normalizeUploadIssue} from '../lib/invoiceUploadIssue.js';
const doc={orderYear:'2026',orderWeek:'45-01',farmKey:null,rawMetadata:{supplier:'KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD'},reviewedMetadata:{}};
test('historical supplier auto matches without manufacturing FarmKey; manual selection preserved',()=>{
 const result=resolveInvoiceHeader(doc,[{FarmKey:null,WarehouseKey:7771,FarmName:'HUBFRESH'}]);
 assert.equal(result.farm.farmKey,null);assert.equal(result.farm.farmSourceWarehouseKey,7771);
 const applied=applyInvoiceHeader({document:doc},result);
 assert.equal(hasReceiptFarmSource(applied.document),true);
 assert.equal(applyInvoiceHeader(applied,result),applied);
 assert.equal(resolveInvoiceHeader({...doc,rawMetadata:{supplier:'NOTHUBFRESH'}},[{WarehouseKey:7771,FarmName:'HUBFRESH'}]).farm,null);
 assert.equal(resolveInvoiceHeader(doc,[{WarehouseKey:1,FarmName:'HUBFRESH'},{WarehouseKey:2,FarmName:'SUPPLY'}]).farm,null);
});
test('historical source is re-read under transaction lock and does not use order week alone',async()=>{
 const document={...doc,reviewedMetadata:{farmName:'HUBFRESH',farmSourceWarehouseKey:7771}};
 let reads=0;
 const queryFn=async(q,p)=>{reads++;assert.match(q,/WITH \(HOLDLOCK\)/);assert.match(q,/WarehouseKey=@farmSourceWarehouseKey/);assert.equal(p.farmSourceWarehouseKey.value,7771);return {recordset:[]};};
 assert.deepEqual(await readReceiptFarmSource({queryFn,types:{Int:1,NVarChar:2},document,locked:true}),[]);
 assert.equal(reads,1);
 for(const key of [null,0,-1,'7771'])assert.equal(hasReceiptFarmSource({...document,reviewedMetadata:{...document.reviewedMetadata,farmSourceWarehouseKey:key}}),false);
});
test('candidate lookup is read only and malformed lookup cannot pass',async()=>{
 await assert.rejects(listInvoiceFarmSources(async q=>{assert.match(q,/UNION ALL/);assert.doesNotMatch(q,/INSERT|UPDATE|DELETE/);return {};}));
});
test('upload error detail is bounded, redacted and accepted by the logging contract',()=>{
 const detail=uploadFailureDetail('농장 검색 실패 token=private password=hidden Bearer abc');
 assert.match(detail,/농장 검색 실패/);assert.doesNotMatch(detail,/private|hidden|abc/);
 assert.equal(uploadFailureDetail('x'.repeat(3000)).length,2000);
 assert.equal(normalizeUploadIssue({eventId:'00000000-0000-4000-8000-000000000001',fileName:'45-1.pdf',code:'UPLOAD_FAILED',count:1,detail}).detail,detail);
});
