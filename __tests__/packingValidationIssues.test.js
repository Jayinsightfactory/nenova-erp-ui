const test=require('node:test');
const assert=require('node:assert/strict');
const {packingValidationIssues}=require('../lib/packingValidationIssues.js');
const {makePackingReviewRows,applyPackingReview}=require('../lib/importPackingReview.js');
const {normalizePackingMetadata}=require('../lib/importPackingMetadata.js');
test('metadata diagnostics expose original/expected values and preserve zero',()=>{
 const [issue]=packingValidationIssues([{invoice:'I',invoice_total:0,extractionIssues:[{code:'INVOICE_TOTAL_MISMATCH',field:'invoice_total',message:'합계 불일치',expected:5,extractedValue:0}]}]);
 assert.equal(issue.field,'invoice_total');assert.match(issue.text,/현재 0.*기준 5/);
});
test('invalid source prices identify exact invoice and row without inventing values',()=>{
 const rows=packingValidationIssues([{invoice:'I',pdfReviewRequired:true,products:[{description:'Rose',pcs:1,total_bunch:5,total_stems:50,u_price:null,t_price:null}]}],'CN');
 assert.equal(rows.length,2);assert.ok(rows.every(x=>x.invoiceIndex===0&&x.lineIndex===0));assert.match(rows[0].text,/Rose.*단가/);
});
test('NL missing Handling can be explicitly entered and validated; missing or wrong total stays blocked',()=>{
 const inv=normalizePackingMetadata({invoice:'NL',raw_date:'2025-10-20',date:'2025/10/20',date_order:'YMD',date_kind:'arrival',currency:'EUR',invoice_total:105,freight:0,handling:null,lines:[{stems:10,price:10,t_price:100}]},'NL');
 const rows=makePackingReviewRows([inv],'NL');const row=rows[0];row.applyValues=true;
 assert.equal(row.metadata.hasHandling,true);
 row.metadata.reasons.invoice_total='총액 대조';
 assert.throws(()=>applyPackingReview([inv],rows,'NL',undefined,{requireConfirmation:false}),/Handling/);
 row.metadata.values.handling='5';row.metadata.reasons.handling='원문 비용 확인';row.metadata.reasons.invoice_total='총액 대조';
 const [out]=applyPackingReview([inv],rows,'NL',undefined,{requireConfirmation:false});
 assert.equal(out.handling,5);assert.equal(out.date,'2025/10/20');assert.deepEqual(out.extractionIssues,[]);
 row.metadata.values.handling='0';
 assert.throws(()=>applyPackingReview([inv],rows,'NL',undefined,{requireConfirmation:false}),/차이 5/);
});
