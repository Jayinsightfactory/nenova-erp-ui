import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceAmountReview,invoiceAmountConfirmed} from '../lib/invoiceAmountReview.js';
const make=()=>({sourceHash:'a'.repeat(64),rawMetadata:{invoiceTotal:110,currency:'CNY',freight:10},reviewedMetadata:{country:'CN'},lines:[{lineId:'1',prodKey:3,lineAmount:100,currency:'CNY'}]});
test('NL reviewed freight and handling replace source amounts, zero is preserved and currency mismatch blocks',()=>{
 const d=make();d.reviewedMetadata.country='NL';
 d.reviewedMetadata.costInputs={freight:{amount:0,currency:'CNY'},docFee:{amount:10,currency:'CNY'}};
 assert.equal(invoiceAmountReview(d).total,110);
 d.reviewedMetadata.costInputs.freight.amount=20;
 assert.equal(invoiceAmountReview(d).total,130);assert.equal(invoiceAmountReview(d).matches,false);
 d.reviewedMetadata.costInputs.freight.currency='USD';
 assert.equal(invoiceAmountReview(d).total,null);
});
test('CN separates goods and additional charges; exact confirmation is bound to current source and amounts',()=>{
 const d=make(), r=invoiceAmountReview(d);assert.equal(r.goods,100);assert.equal(r.total,110);assert.equal(r.matches,true);
 d.reviewedMetadata.amountConfirmation={basis:r.basis,sourceSeen:true};assert.equal(invoiceAmountConfirmed(d),true);
 d.lines[0].lineAmount=101;assert.equal(invoiceAmountConfirmed(d),false);
});
test('missing total, mixed currency and mismatched amount never allow registration confirmation',()=>{
 for(const change of [d=>delete d.rawMetadata.invoiceTotal,d=>d.lines[0].currency='USD',d=>d.rawMetadata.invoiceTotal=120,d=>d.lines[0].lineAmount=null]){
  const d=make();change(d);assert.equal(invoiceAmountReview(d).matches,false);
 }
});
test('zero is explicit; freight is not added again for AU CNF',()=>{
 const d=make();d.rawMetadata.invoiceTotal=0;d.rawMetadata.freight=0;d.lines[0].lineAmount=0;assert.equal(invoiceAmountReview(d).matches,true);
 d.reviewedMetadata.country='AU';d.rawMetadata.freight=500;assert.equal(invoiceAmountReview(d).extras,0);
});
