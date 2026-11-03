import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileInvoiceSupplier as reconcile} from '../lib/invoiceSupplierEvidence.js';
const invoice={invoice:'XJ-2026-NN009',supplier:'Cloudland',products:[{t_price:255}]};
const page={text:'KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD INVOICE NO. XJ-2026-NN009'};
test('literal same-invoice PDF header corrects supplier without touching values',()=>{
 const result=reconcile(invoice,'CN',{pages:[page]});assert.equal(result.supplier,'HUBFRESH');assert.equal(invoice.supplier,'Cloudland');
 assert.equal(result.products,invoice.products);assert.equal(result.metadata_evidence.supplier.page,1);
});
test('other invoice, other country, ambiguous headers and missing text never infer supplier',()=>{
 for(const [country,source]of [['AU',{pages:[page]}],['CN',null],['CN',{pages:[page,page]}],['CN',{pages:[{text:page.text+' CLOUDLAND'}]}],['CN',{pages:[{text:page.text.replace('NN009','NN008')}]}]])assert.equal(reconcile(invoice,country,source),invoice);
});

const source=()=>({pages:[{text:page.text+' 日期DATE: 02/11/2026',items:[{str:'A.G.W.T.',x:436,y:691}]},
 {text:'TOTAL 180 1,905 21,900 1,684.80 39,720.00',items:[{str:'TOTAL',x:64,y:542},{str:'1,684.80',x:437,y:542},{str:'39,720.00',x:460,y:542}]}]});
test('same-invoice positioned total and supplier DMY fix cached header only',()=>{
 const out=reconcile({...invoice,date:'2026/02/11',extractionIssues:[{code:'DATE_CONFLICT'},{code:'OTHER'}]},'CN',source());
 assert.equal(out.date,'2026/11/02');assert.equal(out.gross_weight,1684.8);
 assert.equal(out.review_evidence.gross_weight.unit,'kg');assert.equal(out.review_evidence.gross_weight.page,2);
 assert.equal(out.vol_weight,undefined);assert.equal(out.products,invoice.products);
 assert.deepEqual(out.extractionIssues,[{code:'OTHER'}]);
});
test('manual header inputs and explicit zero GW are never overwritten',()=>{
 const input={...invoice,date:'2026/11/03',gross_weight:0,packingReview:{values:{gw:0}}};
 const out=reconcile(input,'CN',source());assert.equal(out.date,input.date);assert.equal(out.gross_weight,0);
});
test('missing/duplicate weight column or totals do not invent GW',()=>{
 for(const mode of ['missing','duplicateColumn','duplicateTotal','net']){
  const s=source();if(mode==='missing')s.pages[0].items=[];
  if(mode==='duplicateColumn')s.pages[0].items.push({...s.pages[0].items[0]});
  if(mode==='duplicateTotal')s.pages.push(s.pages[1]);
  if(mode==='net')s.pages[0].items[0].str='NET WEIGHT';
  assert.equal(reconcile(invoice,'CN',s).gross_weight,undefined,mode);
 }
});
test('invalid date, other invoice year and multiple invoices fail closed',()=>{
 for(const raw of ['31/02/2026','02/11/2025']){
  const s=source();s.pages[0].text=s.pages[0].text.replace('02/11/2026',raw);
  assert.equal(reconcile(invoice,'CN',s).date,undefined);
 }
 const s=source();s.pages[1].text+=' INVOICE NO. OTHER-123';
 const out=reconcile(invoice,'CN',s);assert.equal(out.date,undefined);assert.equal(out.gross_weight,undefined);
});
test('corrected headers flow through receipt adapter and historical-farm autofill',async()=>{
 const {adaptPackingReceipts}=await import('../lib/importPackingReceiptAdapter.js');
 const {resolveInvoiceHeader}=await import('../lib/invoiceReceiptAutoFill.js');
 const corrected=reconcile({...invoice,date:'2026/02/11'},'CN',source());
 const [doc]=await adaptPackingReceipts({sourceHash:'a'.repeat(64),country:'CN',fileName:'2026 45-1.xlsx',reviewConfirmed:true,
  invoices:[{...corrected,products:[]}],excels:[{products:[]}]});
 const resolved=resolveInvoiceHeader(doc,[{WarehouseKey:99111,FarmName:'HUBFRESH'}]);
 assert.equal(resolved.inputDate,'2026-11-02');assert.equal(doc.reviewedMetadata.gw,1684.8);
 assert.equal(doc.reviewedMetadata.cw,null);assert.equal(doc.orderYear,'2026');assert.equal(doc.orderWeek,'45-01');
});
