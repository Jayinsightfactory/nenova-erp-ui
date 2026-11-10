import assert from 'node:assert/strict';
import { packingInvoiceTotals, receiptLineTotals } from '../lib/importPackingReceiptAdapter.js';
const nl=packingInvoiceTotals({currency:'EUR',freight:321.49,handling:50,invoice_total:1763.39,lines:[{stems:100,price:13.919}]},'NL');
assert.equal(nl.goods,1391.9);assert.equal(nl.invoiceTotal,1763.39);assert.equal(nl.handling,50);assert.equal(nl.stems,100);assert.equal(nl.boxes,null);
for(const country of ['CN','CO','EC','TH','AU','US','VN']){
 const t=packingInvoiceTotals({currency:'USD',invoice_total:20,products:[{pcs:2,total_bunch:10,total_stems:50,bunch_st:5,u_price:2,t_price:20}]},country);
 assert.equal(t.goods,20);assert.equal(t.stems,50);assert.equal(t.invoiceTotal,20);
}
assert.equal(receiptLineTotals([{boxQuantity:0,lineAmount:0}]).boxes,0);
assert.equal(receiptLineTotals([{boxQuantity:null,lineAmount:null}]).boxes,null);
console.log('PASS packing invoice totals all8 countries, zero vs absent, separate units');
