import test from 'node:test';
import assert from 'node:assert/strict';
import {packingHistoryComparison} from '../lib/packingHistoryComparison.js';
const invoice={invoice_no:'25571',currency:'USD',products:[{description:'Hydrangea',pcs:3,total_stems:90,u_price:.9,t_price:81}]};
test('original and stored current analysis remain separate; missing bunches are not zero',()=>{
 const snapshot={country:'CO',lastExtraction:{sourceInvoices:[invoice],result:{invoices:[{...invoice,products:[{...invoice.products[0],pcs:4,t_price:108}]}]}}};
 const before=structuredClone(snapshot),result=packingHistoryComparison(snapshot);
 assert.equal(result.source[0].totals.boxes,3);assert.equal(result.current[0].totals.boxes,4);
 assert.equal(result.source[0].totals.bunches,null);assert.equal(result.source[0].totals.amount,81);assert.deepEqual(snapshot,before);
});
test('currency and invoices never merged; explicit zero preserved',()=>{
 const invoices=[invoice,{...invoice,currency:'EUR',products:[{pcs:0,total_bunch:0,total_stems:0,t_price:0,u_price:0}]}];
 const result=packingHistoryComparison({country:'CO',lastExtraction:{sourceInvoices:invoices,result:{invoices}}});
 assert.equal(result.source.length,2);assert.equal(result.source[1].currency,'EUR');assert.equal(result.source[1].totals.amount,0);
});
test('Netherlands derived line amount uses canonical source fields',()=>{
 const invoices=[{currency:'EUR',lines:[{stems:20,price:2}]}];
 assert.equal(packingHistoryComparison({country:'NL',lastExtraction:{sourceInvoices:invoices,result:{invoices}}}).source[0].totals.amount,40);
 assert.throws(()=>packingHistoryComparison({country:'CO'}));
});
