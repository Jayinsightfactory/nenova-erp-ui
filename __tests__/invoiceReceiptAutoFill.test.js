import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceCalendarDate,invoiceSupplierKey,resolveInvoiceHeader,applyInvoiceHeader,sameInvoiceSupplier,packingWeight,fillMissingReceiptWeights} from '../lib/invoiceReceiptAutoFill.js';
const source=()=>({orderYear:'2026',orderWeek:'44-01',farmKey:null,receiptStatus:'DRAFT',revision:1,
  rawMetadata:{supplier:'CI FLORES BALVERDE SAS',invoiceDate:'2026-10-23',rawDate:'23OCT2026'},
  reviewedMetadata:{inputDate:'',farmName:'CI FLORES BALVERDE SAS'},lines:[{prodKey:866,boxQuantity:5,stemQuantity:150}]});
const farms=[{FarmKey:41,FarmName:'Balverde'}];
test('weight evidence wins over absent/legacy values; CW never derives from GW/net',()=>{
 const invoice={gross_weight:0,net_weight:663.4,review_evidence:{gross_weight:{value:759.7,unit:'kg',quote:'GRSWGHT 759,70'},vol_weight:{value:null,unit:'kg'}}};
 assert.equal(packingWeight(invoice,'gw'),759.7);assert.equal(packingWeight(invoice,'cw'),null);
 for(const value of [null,'',true,-1,'759,70','bad',Infinity])assert.equal(packingWeight({review_evidence:{gross_weight:{value,unit:'kg'}},gross_weight:123},'gw'),null);
 assert.equal(packingWeight({review_evidence:{gross_weight:{value:759.7,unit:'lb'}}},'gw'),null);
 assert.equal(packingWeight({...invoice,packingReview:{values:{gw:0,cw:800}}},'gw'),0);
 assert.equal(packingWeight({...invoice,packingReview:{values:{gw:null}}},'gw'),null);
 assert.equal(packingWeight({gross_weight:759.7},'cw'),null);
});
test('same-source empty saved draft gets weight without overwriting manual/zero/committed/cross-year values',()=>{
 const doc={...source(),documentId:'d',sourceHash:'hash',reviewedMetadata:{gw:null,cw:null}};
 const incoming={...doc,reviewedMetadata:{gw:759.7,cw:null,weightSourceEvidence:{gw:{quote:'GRSWGHT 759,70'}}}};
 const filled=fillMissingReceiptWeights({document:doc,dirty:false},incoming);
 assert.equal(filled.document.reviewedMetadata.gw,759.7);assert.equal(filled.document.reviewedMetadata.cw,null);
 assert.equal(filled.document.revision,1);assert.equal(filled.dirty,true);assert.deepEqual(filled.document.lines,doc.lines);
 for(const record of [{document:{...doc,orderYear:'2025'}},{document:{...doc,sourceHash:'other'}},{document:doc,pendingOperation:{}},
  {document:doc,recoveryRequired:true},{document:{...doc,receiptStatus:'COMMITTED'}},{document:{...doc,warehouseKey:5}},
  ...[0,800].map(gw=>({document:{...doc,reviewedMetadata:{gw,cw:900}}})),
  {document:{...doc,reviewedMetadata:{gw:null,weightManual:{gw:true}}}}])assert.equal(fillMissingReceiptWeights(record,incoming),record);
});
test('adapter propagates evidence-only CO weight into draft and raw metadata',async()=>{
 const {adaptPackingReceipts}=await import('../lib/importPackingReceiptAdapter.js');
 const [doc]=await adaptPackingReceipts({sourceHash:'a'.repeat(64),country:'CO',fileName:'2026 44-1.xlsx',reviewConfirmed:true,
  invoices:[{invoice:'25529',date:'2026-10-23',review_evidence:{gross_weight:{value:759.7,unit:'kg',quote:'GRSWGHT 759,70'},vol_weight:{value:null,unit:'kg'}},products:[]}],excels:[{products:[]}]});
 assert.equal(doc.reviewedMetadata.gw,759.7);assert.equal(doc.rawMetadata.grossWeight,759.7);assert.equal(doc.reviewedMetadata.cw,null);
});
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
