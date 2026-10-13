const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const XLSX = require('xlsx-js-style');
const ready = Promise.all([
  import('../lib/importPackingExtractClient.js'), import('../lib/importPackingResponse.js'),
  import('../lib/importPacking.js'), import('../lib/importPackingSourceReview.js'),
  import('../lib/importChinaInvoiceFormat.js'),
]);
function invoice(price = 5) {
  return { invoice:'TEST-PDF',supplier:'Hubfresh',source_format:'china_invoice_pdf',currency:'CNY',
    date:'2025-10-14',raw_date:'2025-10-14',date_order:'YMD',date_kind:'invoice',
    invoice_total:price == null ? 12 : 2*price+2,total_value:price == null ? 12 : 2*price+2,
    item_subtotal:price == null ? 10 : 2*price,freight:2,gross_weight:3,vol_weight:null,
    total_boxes:1,total_bunches:2,total_stems:8,
    additional_costs:[{description:'Packing',quantity:1,unit_price:2,amount:2}],
    products:[{description:'Rose Test [family:ROSE] [length:60CM]',source_description:'Rose Test',
      source_format:'china_invoice_pdf',source_row:1,stem_length:'60cm',family:'ROSE',
      pcs:1,total_bunch:2,total_stems:8,bunch_st:4,steam_box:8,u_price:price,t_price:price == null ? null : 2*price}],
  };
}
test('CN positioned text success routes to local result without even contacting parse-pdf',async()=>{
 const [client,response]=await ready;
 const {makeChinaPdfFixture}=await import('./fixtures/chinaPdfFixture.js');let calls=0;
 const out=await client.extractPackingDocument({country:'CN',pdfBase64:'synthetic',readPdf:async()=>makeChinaPdfFixture(),fetchImpl:async()=>{calls++;throw Error('network forbidden');}});
 assert.equal(out.source,'local');assert.equal(calls,0);
 assert.equal(response.parsePackingResponse(out.data,'CN').wasTruncated,false);
});
test('CN local rejection never invokes AI, unknown countries do not enter parser',async()=>{
 const [client]=await ready;let reads=0,calls=0;
 for(const country of ['CN','NL','CO']){
  const out=await client.extractPackingDocument({country,pdfBase64:'x',readPdf:async()=>{reads++;return {pages:[]};},fetchImpl:async()=>{calls++;throw Error('paid forbidden');}});
  assert.equal(out.needsAI,true);
 }
 assert.equal(reads,2);assert.equal(calls,0);
});
test('structured PDF format preserves exact CN boxes/bunches/stems in workbook',async()=>{
 const [,,packing,,formats]=await ready;
 assert.equal(formats.isModernChinaInvoice('china_invoice_pdf'),true);
 assert.equal(formats.isModernChinaInvoice('china_invoice_xlsx'),true);
 assert.equal(formats.isStructuredChinaInvoice('china_legacy_invoice_reviewed'),true);
 assert.equal(formats.isStructuredChinaInvoice('china_legacy_invoice_xlsx'),false);
 const inv=invoice(),out=packing.genChina(XLSX,inv,'41','1');
 assert.equal(out.totalMismatch,null);assert.equal(out.invoiceTotal,12);
 assert.deepEqual(out.sourceTotals,{boxes:1,bunches:2,stems:8});
 assert.equal(out.products[0].boxes,1);assert.equal(out.products[0].stems,8);
 assert.equal(out.products[0].stemLength,'60cm');
 const wb=XLSX.read(out.buf,{type:'array',cellFormula:true}),ws=wb.Sheets[wb.SheetNames[0]];
 const cells=Object.values(ws).filter(c=>c&&typeof c==='object'&&c.v==='Rose Test [length: 60cm]');
 assert.ok(cells.length>0);
});
test('dash price stays null and blocks generation and source confirmation; numeric zero is distinct',async()=>{
 const [,response,packing,review]=await ready;
 const inv=invoice(null),out=response.parsePackingResponse({content:[{type:'text',text:JSON.stringify({invoices:[inv]})}],stop_reason:'end_turn'},'CN').result.invoices[0];
 assert.equal(out.products[0].u_price,null);assert.equal(out.products[0].t_price,null);
 assert.ok(out.extractionIssues.some(x=>x.code==='AMOUNT_COMPONENTS_UNAVAILABLE'));
 assert.throws(()=>packing.genChina(XLSX,out,'41','1'),/원본 수량\/숫자/);
 const bound={...out,pdfSourceHash:'a'.repeat(64),pdfReviewRequired:true};
 const draft=review.makePackingSourceReview(bound,'CN');draft.pdf={rendered:true,page:1};draft.rows.forEach(r=>r.confirmed=true);
 assert.throws(()=>review.applyPackingSourceReview(bound,draft,'CN'),/값이 비어/);
 draft.rows[0].values.u_price=0;draft.rows[0].values.t_price=0;
 assert.throws(()=>review.applyPackingSourceReview(bound,draft,'CN'),/사유/);
 draft.rows[0].reason='TEST fixture only: explicit confirmation of zero';
 const applied=review.applyPackingSourceReview(bound,draft,'CN');
 assert.equal(applied.products[0].u_price,0);
 assert.equal(packing.genChina(XLSX,invoice(0),'41','1').totalMismatch,null);
});

test('offsetting row-price errors cannot pass structured China generation',async()=>{
 const [,,packing]=await ready;
 for(const format of ['china_invoice_pdf','china_invoice_xlsx']){
  const inv=invoice();inv.source_format=format;
  inv.products=[{...inv.products[0],source_format:format,t_price:9},{...inv.products[0],source_format:format,source_row:2,t_price:11}];
  inv.item_subtotal=20;inv.invoice_total=22;inv.total_value=22;
  assert.throws(()=>packing.genChina(XLSX,inv,'41','1'),/원본 수량\/숫자/);
 }
});
test('actual private 41-1 PDF fixture extracts locally with zero network calls',{skip:!process.env.CHINA_PDF_FIXTURE},async()=>{
 const [client,response]=await ready;let calls=0;
 const data=JSON.parse(fs.readFileSync(process.env.CHINA_PDF_FIXTURE,'utf8'));
 assert.equal(data.pages.length,7);
 const out=await client.extractPackingDocument({country:'CN',pdfBase64:'private-fixture',readPdf:async()=>data,fetchImpl:async()=>{calls++;throw Error('network forbidden');}});
 assert.equal(out.source,'local');assert.equal(calls,0);
 const inv=response.parsePackingResponse(out.data,'CN').result.invoices[0];
 assert.equal(inv.products.length,101);
 for(const [field,value] of Object.entries({total_boxes:429,total_bunches:5390,total_stems:68775,gross_weight:4005.12,item_subtotal:126325,freight:45825.5,invoice_total:172150.5}))assert.equal(inv[field],value,field);
 assert.equal(inv.vol_weight,null);
 const missing=inv.products.filter(p=>p.u_price==null);assert.equal(missing.length,1);
 assert.equal(missing[0].total_bunch,140);
 assert.ok(inv.extractionIssues.some(x=>x.code==='AMOUNT_COMPONENTS_UNAVAILABLE'));
});
test('PDF receipt draft is blocked before source review; confirmed source retains quantities and GW without writes',async()=>{
 const [,,packing,review]=await ready;
 const adapter=await import('../lib/importPackingReceiptAdapter.js');
 const hash='b'.repeat(64),inv={...invoice(),pdfSourceHash:hash,pdfReviewRequired:true};
 inv.products[0].gross_weight=3;
 inv.products[0].source_cells={gross_weight:{page:2,quote:'3.00',value:3}};
 await assert.rejects(()=>adapter.adaptPackingReceipts({invoices:[inv],country:'CN',fileName:'2025 41-1.pdf',sourceHash:hash}),/원본 PDF/);
 const draft=review.makePackingSourceReview(inv,'CN');draft.pdf={rendered:true,page:1};draft.rows.forEach(r=>r.confirmed=true);
 const confirmed=review.applyPackingSourceReview(inv,draft,'CN');
 const excel=packing.genChina(XLSX,confirmed,'41','1');
 excel.sourceInvoiceIdentity=adapter.packingInvoiceSourceIdentity(confirmed,0);
 const out=await adapter.adaptPackingReceipts({invoices:[confirmed],excels:[excel],country:'CN',fileName:'2025 41-1.pdf',sourceHash:hash,reviewConfirmed:true});
 assert.equal(out[0].lines[0].boxQuantity,1);assert.equal(out[0].lines[0].bunchQuantity,2);assert.equal(out[0].lines[0].stemQuantity,8);
 assert.equal(out[0].lines[0].sourceEvidence.grossWeightKg,3);
 assert.equal(out[0].lines[0].sourceEvidence.grossWeightEvidence.sourcePage,2);
 assert.equal(out[0].lines[0].sourceEvidence.grossWeightEvidence.sourceQuote,'3.00');
 assert.equal(out[0].lines[0].sourceEvidence.sourceFormat,'china_invoice_pdf');
 assert.equal(out[0].receiptStatus,'DRAFT');
});
