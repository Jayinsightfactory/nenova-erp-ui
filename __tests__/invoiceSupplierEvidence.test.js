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
