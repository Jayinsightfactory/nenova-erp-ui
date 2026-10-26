import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceCalendarDate,invoiceSupplierKey,resolveInvoiceHeader,applyInvoiceHeader,sameInvoiceSupplier} from '../lib/invoiceReceiptAutoFill.js';
const source=()=>({orderYear:'2026',orderWeek:'44-01',farmKey:null,receiptStatus:'DRAFT',revision:1,
  rawMetadata:{supplier:'CI FLORES BALVERDE SAS',invoiceDate:'2026-10-23',rawDate:'23OCT2026'},
  reviewedMetadata:{inputDate:'',farmName:'CI FLORES BALVERDE SAS'},lines:[{prodKey:866,boxQuantity:5,stemQuantity:150}]});
const farms=[{FarmKey:41,FarmName:'Balverde'}];
test('valid AWB suggests AIR but missing/invalid AWB or manual transport is not replaced',()=>{
 for(const [awb,expected] of [['160-96630575','AIR'],['160-96630574',''],['',''],['BL-123','']]){
  const doc=source();doc.reviewedMetadata.awb=awb;
  const resolution=resolveInvoiceHeader(doc,farms);assert.equal(resolution.transportMode,expected);
  doc.reviewedMetadata.transportMode='SEA';
  assert.equal(applyInvoiceHeader({document:doc},resolution).document.reviewedMetadata.transportMode,'SEA');
 }
});
test('same invoice supplier recognizes stored full company name, not another farm',()=>{
 assert.equal(sameInvoiceSupplier('C.I Flores Balverde S.A.S',source(),'Balverde'),true);
 assert.equal(sameInvoiceSupplier('Balverde North',source(),'Balverde'),false);
 assert.equal(sameInvoiceSupplier('',source(),'Balverde'),false);
});
test('44-1 invoice resolves header without any existing receipt data',()=>{
 const doc=source(), result=resolveInvoiceHeader(doc,farms);
 assert.equal(result.farm.farmKey,41);assert.equal(result.inputDate,'2026-10-23');assert.deepEqual(result.issues,[]);
 const record=applyInvoiceHeader({document:doc,dirty:false},result);
 assert.equal(record.document.farmKey,41);assert.equal(record.document.reviewedMetadata.inputDate,'2026-10-23');
 assert.equal(record.document.revision,1);assert.deepEqual(record.document.lines,doc.lines);assert.equal(record.dirty,true);
});
test('canonical date validates calendar and compact month names, no today fallback',()=>{
 assert.equal(invoiceCalendarDate('23OCT2026'),'2026-10-23');assert.equal(invoiceCalendarDate('2026/10/23'),'2026-10-23');
 for(const invalid of ['','2026-02-30','31FEB2026','10/11/26','23OCT26'])assert.equal(invoiceCalendarDate(invalid),'');
});
test('conflicting dates, other year, missing date never auto-fill',()=>{
 for(const doc of [{...source(),orderYear:'2025'},{...source(),rawMetadata:{...source().rawMetadata,rawDate:'24OCT2026'}},{...source(),rawMetadata:{supplier:'Balverde'}}]){
  assert.equal(resolveInvoiceHeader(doc,farms).inputDate,'');
 }
});
test('ambiguous/deleted/no farm never pick first fuzzy candidate',()=>{
 assert.equal(resolveInvoiceHeader(source(),[...farms,{FarmKey:42,FarmName:'C.I Flores Balverde S.A.S'}]).farm,null);
 assert.equal(resolveInvoiceHeader(source(),[{...farms[0],isDeleted:true}]).farm,null);
 assert.equal(resolveInvoiceHeader(source(),[{FarmKey:3,FarmName:'Balverde North'}]).farm,null);
 assert.equal(invoiceSupplierKey('C.I Flores Balverde S.A.S'),'BALVERDE');
});
test('manual values and completed or unknown operations are preserved',()=>{
 const resolution=resolveInvoiceHeader(source(),farms);
 const manual={document:{...source(),farmKey:50,reviewedMetadata:{inputDate:'2026-10-24',farmName:'Manual'}},dirty:true};
 assert.equal(applyInvoiceHeader(manual,resolution),manual);
 for(const record of [{document:{...source(),receiptStatus:'COMMITTED'}},{document:source(),pendingOperation:{operationId:'pending'}},{document:{...source(),operations:[{status:'COMMITTED'}]}}])assert.equal(applyInvoiceHeader(record,resolution),record);
});
