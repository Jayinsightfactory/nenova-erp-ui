const test=require('node:test'),assert=require('node:assert/strict');
const {blockingPackingIssues,receiptSourceDate}=require('../lib/packingReceiptDatePolicy.js');
const {assertPackingSourceValues}=require('../lib/importPackingSourceReview.js');
const {adaptPackingReceipts}=require('../lib/importPackingReceiptAdapter.js');
const {buildPackingMatchPreview}=require('../lib/importPackingMatchPreview.js');
test('reference date warning does not mark every matched row as a quantity error',()=>{
 const invoice={invoice:'42-1',pdfSourceHash:'a'.repeat(64),pdfReviewRequired:true,
 extractionIssues:[{code:'DATE_ORDER_AMBIGUOUS'}],products:[{description:'Ammi',pcs:4,total_bunch:40,total_stems:400,u_price:18,t_price:720,bunch_st:10}]};
 const preview=()=>buildPackingMatchPreview({invoices:[invoice],country:'CN',erpMatches:{products:[],value:{entries:[]}}})[0].products[0];
 assert.equal(preview().sourceReview.required,false);
 invoice.extractionIssues.push({code:'INVOICE_TOTAL_MISMATCH'});
 assert.equal(preview().sourceReview.required,true);
});
test('printed-date review does not block valid invoice quantities; money errors still block',()=>{
 const invoice={pdfSourceHash:'a'.repeat(64),pdfReviewRequired:true,products:[{description:'Ammi',pcs:4,total_bunch:40,total_stems:400,u_price:18,t_price:720,bunch_st:10}],
 extractionIssues:[{code:'DATE_ORDER_AMBIGUOUS',field:'date_order'}],raw_date:'10/10/2026',date:'2026/10/10'};
 assert.equal(blockingPackingIssues(invoice.extractionIssues).length,0);
 assert.equal(receiptSourceDate(invoice),'');assert.equal(assertPackingSourceValues(invoice,'CN'),true);
 invoice.extractionIssues.push({code:'INVOICE_TOTAL_MISMATCH'});assert.throws(()=>assertPackingSourceValues(invoice,'CN'));
 assert.equal(invoice.raw_date,'10/10/2026');
 assert.equal(receiptSourceDate({date:'2026/10/10'}),'2026-10-10');
 assert.equal(receiptSourceDate({date:'2026-02-30'}),'');
 assert.equal(blockingPackingIssues([{code:'DATE_UNKNOWN_NEW_GUARD'}]).length,1);
});
test('ambiguous printed date reaches receipt form, preserves evidence, never supplies InputDate',async()=>{
 const invoice={invoice:'XJ-2026-NN006',date:'2026/10/10',raw_date:'10/10/2026',pdfSourceHash:'a'.repeat(64),pdfReviewRequired:true,
 currency:'CNY',extractionIssues:[{code:'DATE_ORDER_AMBIGUOUS',field:'date_order'}],
 products:[{description:'Ammi',pcs:4,total_bunch:40,total_stems:400,u_price:18,t_price:720,bunch_st:10}]};
 const [doc]=await adaptPackingReceipts({invoices:[invoice],excels:[{products:[{sourceName:'Ammi',matchingDescription:'Ammi',matchedName:'Ammi'}]}],
 country:'CN',fileName:'2026 42-1.pdf',sourceHash:'a'.repeat(64),reviewConfirmed:true,products:[{ProdKey:1,ProdName:'Ammi',country:'CN',selectable:true}]});
 assert.equal(doc.rawMetadata.rawDate,'10/10/2026');assert.equal(doc.rawMetadata.extractionIssues.length,1);
 assert.equal(doc.reviewedMetadata.inputDate,'');assert.equal(doc.reviewedMetadata.invoiceDate,'');
 assert.equal(doc.invoiceYear,'2026');assert.equal(doc.lines[0].boxQuantity,4);
});
