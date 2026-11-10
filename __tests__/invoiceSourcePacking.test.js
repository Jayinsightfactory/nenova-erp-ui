import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePackingForCost} from '../lib/invoiceSourcePacking.js';
import {parsePackingResponse} from '../lib/importPackingResponse.js';
import {resolveInvoiceHeader} from '../lib/invoiceReceiptAutoFill.js';
import {normalizePackingDate} from '../lib/importPackingMetadata.js';

test('cost-only explicit packing survives absent bunch totals without changing receipt',()=>{
 const line={stemQuantity:750,boxQuantity:25,bunchQuantity:null};const before=JSON.stringify(line);
 assert.deepEqual(sourcePackingForCost(line,{packing:{stemsPerBunch:1,stemsPerBox:30}}),{stemsPerBunch:1,bunchesPerBox:30});
 assert.equal(JSON.stringify(line),before);
 for(const value of [null,0,-1,'1',false])assert.equal(sourcePackingForCost(line,{packing:{stemsPerBunch:value}}).stemsPerBunch,null);
 assert.equal(sourcePackingForCost(line,{packing:{stemsPerBunch:1,stemsPerBox:40}}).stemsPerBunch,null);
 assert.equal(sourcePackingForCost({...line,bunchQuantity:75},{packing:{stemsPerBunch:1}}).stemsPerBunch,null);
});
test('canonical AI date is YMD while printed source order remains DMY',()=>{
 assert.equal(normalizePackingDate('2026/11/06',{dateOrder:'DMY'}),'2026/11/06');
 assert.equal(normalizePackingDate('2026/02/30',{dateOrder:'DMY'}),null);
 assert.equal(normalizePackingDate('6/11/26',{dateOrder:'DMY'}),null);
 assert.equal(normalizePackingDate('NOVIEMBRE 06 DE 2026'),'2026/11/06');
 assert.equal(normalizePackingDate('viernes, 6 de noviembre de 2026'),'2026/11/06');
 assert.equal(normalizePackingDate('6NOV.2026'),'2026/11/06');
 assert.equal(normalizePackingDate('NOVIEMBRE 31 DE 2026'),null);
});
test('unique master wins over historical same supplier, never over second master',()=>{
 const doc={orderYear:'2026',rawMetadata:{supplier:'CI FLORES BALVERDE SAS'},reviewedMetadata:{}};
 const farms=[{FarmKey:1,FarmName:'Balverde'},{WarehouseKey:9,FarmName:'C.I Flores Balverde S.A.S'}];
 assert.equal(resolveInvoiceHeader(doc,farms).farm.farmKey,1);
 assert.equal(resolveInvoiceHeader(doc,[...farms,{FarmKey:2,FarmName:'Balverde'}]).farm,null);
});
test('same-source master AWB preserves house reference and rejects actual numeric conflict',()=>{
 const invoice={invoice:'0634',awb:'AFMD00568499',supplier:'Farm',products:[{description:'Hydrangea',pcs:1,total_stems:30,bunch_st:1,steam_box:30,u_price:1,t_price:30}]};
 const response=awb=>({content:[{type:'text',text:JSON.stringify({master_awb:'160-17338020',invoices:[{...invoice,awb}]})}],stop_reason:'end_turn'});
 const {result}=parsePackingResponse(response(invoice.awb),'CO');
 assert.equal(result.invoices[0].awb,'160-17338020');assert.equal(result.invoices[0].house_awb,invoice.awb);
 assert.equal(result.invoices[0].invoice,'0634');
 assert.throws(()=>parsePackingResponse(response('160-17338005'),'CO'),/AWB/);
});

test('two-digit year needs same-PDF explicit year proof and shared valid master',()=>{
 const row={description:'Hydrangea',pcs:1,total_stems:30,bunch_st:1,steam_box:30,u_price:1,t_price:30};
 const peer={invoice:'A',supplier:'Farm A',date:'2026/11/06',raw_date:'2026/11/06',date_order:'YMD',date_kind:'invoice',currency:'USD',invoice_total:30,freight_total:0,products:[row],metadata_evidence:{date:{page:1,quote:'DATE 2026/11/06'}}};
 const target={...peer,invoice:'B',supplier:'Farm B',raw_date:'06-nov-26',date_order:'DMY',metadata_evidence:{date:{page:2,quote:'DATE 06-nov-26'}}};
 const run=(invoices,master_awb='160-17338020')=>parsePackingResponse({content:[{type:'text',text:JSON.stringify({master_awb,invoices})}],stop_reason:'end_turn'},'CO').result.invoices.at(-1);
 assert.equal(run([peer,target]).extractionIssues.some(x=>x.code==='DATE_YEAR_AMBIGUOUS'),false);
 assert.equal(run([peer,{...target,date_year_evidence:{year:2026,quote:'DUE 06-dic-26'}}]).extractionIssues.some(x=>x.code==='DATE_YEAR_AMBIGUOUS'),false);
 assert.equal(run([target]).extractionIssues.some(x=>x.code==='DATE_YEAR_AMBIGUOUS'),true);
 assert.equal(run([peer,target],'invalid').extractionIssues.some(x=>x.code==='DATE_YEAR_AMBIGUOUS'),true);
 assert.equal(run([peer,{...target,raw_date:'06-nov-25'}]).extractionIssues.some(x=>x.code==='DATE_YEAR_CONFLICT'),true);
 const other={...peer,invoice:'C',date:'2025/11/06',raw_date:'2025/11/06',metadata_evidence:{date:{page:3,quote:'DATE 2025/11/06'}}};
 assert.equal(run([peer,other,target]).extractionIssues.some(x=>x.code==='DATE_YEAR_AMBIGUOUS'),true);
});
