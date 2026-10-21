// Offline real-file replay. No database/client/write imports, no network or AI.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const {inspectChinaPdfInvoice}=await import('../lib/importChinaPdfInvoice.js');
 const {normalizePackingMetadata}=await import('../lib/importPackingMetadata.js');
 const {makePackingReviewRows,applyPackingReview}=await import('../lib/importPackingReview.js');
 const {packingValidationIssues}=await import('../lib/packingValidationIssues.js');
 const {assertPackingSourceValues}=await import('../lib/importPackingSourceReview.js');
 const {buildPackingMatchPreview}=await import('../lib/importPackingMatchPreview.js');
 const {genChina}=await import('../lib/importPacking.js');
 const {adaptPackingReceipts,toReceiptDraftPayload}=await import('../lib/importPackingReceiptAdapter.js');
 const file=process.argv[2]||'C:/Users/USER/Documents/카카오톡 받은 파일/41-1 중국 해상 ci1.pdf';
 const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const doc=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise,pages=[];
 for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();pages.push({items:content.items.filter(x=>x.str?.trim()).map(x=>({str:x.str.trim(),x:x.transform[4],y:Math.round(x.transform[5]),width:x.width}))});}
 await doc.destroy();
 const parsed=inspectChinaPdfInvoice({pages});assert.ok(parsed.result,parsed.reason);
 const source=normalizePackingMetadata({...parsed.result.invoices[0],pdfSourceHash:hash,pdfReviewRequired:true},'CN');
 const issues=packingValidationIssues([source],'CN');assert.ok(issues.length>0);
 const drafts=makePackingReviewRows([source],'CN'),draft=drafts[0];draft.applyValues=true;
 assert.throws(()=>applyPackingReview([source],drafts,'CN',undefined,{requireConfirmation:false}));
 const missing=[];
 for(const row of draft.sourceReview.rows){if(row.values.u_price==null||row.values.u_price===''||row.values.t_price==null||row.values.t_price===''){
  missing.push({row:row.lineIndex+1,description:row.description,price:row.values.u_price,amount:row.values.t_price});
  // Test-only explicit user correction, NOT a production default or claim of actual free goods.
  row.values.u_price=0;row.values.t_price=0;row.reason='격리 테스트: 담당자가 원문 대시를 명시 0으로 확인한 시나리오';
 }}
 draft.metadata.values.date='2026-10-04';draft.metadata.reasons.date='격리 테스트: 원문 날짜 월일 확인';
 draft.metadata.reasons.invoice_total='원문 총액과 상품/부대비 검산';
 const [corrected]=applyPackingReview([source],drafts,'CN',undefined,{requireConfirmation:false});
 assert.equal(assertPackingSourceValues(corrected,'CN'),true);assert.deepEqual(corrected.extractionIssues,[]);
 const catalog=JSON.parse(fs.readFileSync('.test-packing-catalog.json','utf8'));
 const preview=buildPackingMatchPreview({invoices:[corrected],country:'CN',erpMatches:catalog});
 const generated=genChina(require('xlsx-js-style'),corrected,'41','1');
 assert.equal(generated.totalMismatch,null);
 // Adapter tests use actual DB candidate matches; unresolved matches remain unconfirmed.
 const [receipt]=await adaptPackingReceipts({invoices:[corrected],excels:preview,country:'CN',fileName:'2026_41-01_CN.pdf',products:catalog.products,sourceHash:hash,reviewConfirmed:true});
 const payload=toReceiptDraftPayload(receipt);assert.equal(receipt.lines.length,corrected.products.length);
 assert.ok(payload);assert.equal(source.products.filter(x=>x.u_price==null).length,missing.length);
 fs.writeFileSync('.test-packing-real-source.json',JSON.stringify({source,drafts,corrected,preview,receipt}));
 console.log(JSON.stringify({pages:pages.length,rows:corrected.products.length,issues:issues.map(x=>({code:x.code,row:x.lineIndex==null?null:x.lineIndex+1})),missing,generatedBytes:generated.buf.byteLength,receiptRows:receipt.lines.length,confirmedMatches:receipt.lines.filter(x=>x.reviewed?.confirmed).length,operationalWrites:0,aiCalls:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
