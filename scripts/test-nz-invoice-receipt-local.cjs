'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), crypto=require('node:crypto');

module.exports=async ({pool,sql,query,documents,writer,ctx,protectedSnapshot})=>{
  assert.equal(pool.config.server,'127.0.0.1');
  assert.equal(pool.config.port,14339);
  assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
  const source=fs.readFileSync(process.env.NENOVA_NZ_RECEIPT_PDF);
  const sourceHash=crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(sourceHash,'4e4bd50394e9ab29bd932b0098fe36103fefbb823775874fc39708587683e874');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {inspectNzBloomInvoice,packingOriginMismatch}=await import('../lib/packingOriginEvidence.js');
  const {adaptPackingReceipts,toReceiptDraftPayload}=await import('../lib/importPackingReceiptAdapter.js');
  const {applyNzCommonUnits}=await import('../lib/nzReceiptUnits.js');
  const {invoiceAmountReview}=await import('../lib/invoiceAmountReview.js');
  const job=getDocument({data:new Uint8Array(source),useSystemFonts:false});
  const page=await (await job.promise).getPage(1);
  const content=await page.getTextContent();
  const pdf={text:content.items.map(item=>item.str||'').join(' '),pages:[{items:content.items.filter(item=>item.str?.trim()).map(item=>({
    str:item.str.trim(),x:item.transform[4],y:Math.round(item.transform[5]),
  }))}]};
  const invoice=inspectNzBloomInvoice(pdf);
  await job.destroy();
  assert.equal(invoice?.invoice,'210195');
  assert.equal(invoice.awb,'180-79060332');
  assert(packingOriginMismatch(pdf,'AU'));
  await query(pool,`ALTER TABLE dbo.Country ADD CounKey int NULL;`);
  await query(pool,`UPDATE dbo.Country SET CounKey=1 WHERE CounName=N'중국';
    INSERT dbo.Country(CounName,isUseOrderCode,CounKey) VALUES(N'뉴질랜드',0,2);
    INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7113,N'NZ Blooms',2,0);
    INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
      VALUES(2547,N'2025',N'47-01',N'20254701',1,N'fixture'),(2647,N'2026',N'47-01',N'20264701',1,N'fixture');
    INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,Stock,isDeleted)
      VALUES(94301,N'TEST_ONLY Peony Red',N'PEONY',N'뉴질랜드',N'PEONY',N'단',N'단',0,0),
            (94302,N'TEST_ONLY Peony Pink',N'PEONY',N'뉴질랜드',N'PEONY',N'송이',N'송이',0,0),
            (94303,N'TEST_ONLY Peony White',N'PEONY',N'뉴질랜드',N'PEONY',N'송이',N'송이',0,0);`);
  const before=await protectedSnapshot(pool);
  if(process.env.NENOVA_NZ_NATIVE_UI==='1'){
    const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
    const products=packingErpProducts((await query(pool,`SELECT ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
      SteamOf1Box,SteamOf1Bunch,BunchOf1Box,isDeleted FROM dbo.Product WHERE ProdKey BETWEEN 94301 AND 94303`)).recordset);
    const run=await require('./test-packing-native-local.cjs')({pool,sql,query,documents,writer,ctx,protectedSnapshot,
      protectedBefore:before,catalog:{products,value:{version:1,entries:[]}},upsertPackingErpMatch,
      farms:[{FarmKey:7113,FarmName:'NZ Blooms',CounName:'뉴질랜드'}]});
    assert.equal(run.receiptRequests.length,1);
    const [{args,result}]=run.receiptRequests;
    const readback=(await query(pool,`SELECT BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice FROM dbo.WarehouseDetail WHERE WarehouseKey=@key ORDER BY ProdKey`,
      {key:{type:sql.Int,value:result.warehouseKey}})).recordset;
    assert.deepEqual(readback.map(r=>[r.BoxQuantity,r.BunchQuantity,r.SteamQuantity,r.SteamOf1Box,r.SteamOf1Bunch,r.OutQuantity,r.EstQuantity,r.UPrice,r.TPrice]),[
      [3,48,240,80,5,48,48,7.57,1816.8],
      [2,40,200,100,5,200,200,4.7,940],
      [3,60,300,100,5,300,300,4.99,1497],
    ]);
    assert.equal((await ctx.create(args)).warehouseKey,result.warehouseKey);
    await assert.rejects(()=>ctx.create({...args,operationId:crypto.randomUUID(),receiptPartId:crypto.randomUUID()}));
    console.log(JSON.stringify({warehouseKey:result.warehouseKey,readback,duplicateReplay:true,newDuplicateBlocked:true}));
    return;
  }
  const [draft]=await adaptPackingReceipts({country:'NZ',fileName:'2026 47-1 NZ CI.pdf',sourceHash,invoices:[invoice],reviewConfirmed:true});
  assert.equal(draft.orderWeek,'47-01');
  assert.equal(draft.invoiceYear,'2026');
  assert(draft.lines.every(line=>line.stemQuantity===null&&line.bunchQuantity===null&&line.priceUnit===null));
  draft.farmKey=7113;
  Object.assign(draft.reviewedMetadata,{farmName:'NZ Blooms',inputDate:'2026-11-20',transportMode:'AIR'});
  const save=async()=>documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,
    input:toReceiptDraftPayload(draft),documentId:draft.revision?draft.documentId:undefined,actor:'invoice-fixture'});
  for(const [i,line] of draft.lines.entries()) line.prodKey=94301+i;
  const confirmAmount=()=>{draft.reviewedMetadata.amountConfirmation={basis:invoiceAmountReview(draft).basis,sourceSeen:true};};
  confirmAmount();
  const blocked=await save();
  const rejected=await ctx.preview(blocked.documentId,blocked.revision);
  assert.equal(rejected.canCommit,false);
  assert(rejected.issues.some(issue=>issue.code==='NZ_UNITS_EVIDENCE_REQUIRED'));
  draft.revision=blocked.revision;
  const commonApplied=applyNzCommonUnits(draft.lines,draft.lines.map(line=>line.lineId),{
    unit:'송이',
    reason:'TEST_ONLY: fixture maps Units to stems; this is not production evidence',
    ratio:'5',
  });
  assert.equal(commonApplied.applied,3);
  draft.lines=commonApplied.lines.map(line=>({...line,reviewed:{...line.reviewed,erpMatchConfirmed:true}}));
  confirmAmount();
  const doc=await save();
  const preview=await ctx.preview(doc.documentId,doc.revision);
  assert(preview.canCommit,JSON.stringify(preview.issues));
  const args={documentId:doc.documentId,revision:doc.revision,operationId:crypto.randomUUID(),receiptPartId:crypto.randomUUID(),
    baselineDigest:preview.baselineDigest,reason:'TEST_ONLY NZ isolated SQL',allowPendingCost:true,actor:'invoice-fixture'};
  const result=await ctx.create(args);
  const {recordsets:[headers,rows]}=await query(pool,`SELECT OrderYear,OrderWeek,FarmName,InvoiceNo FROM dbo.WarehouseMaster WHERE WarehouseKey=@key;
    SELECT BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice FROM dbo.WarehouseDetail WHERE WarehouseKey=@key ORDER BY ProdKey;`,
    {key:{type:sql.Int,value:result.warehouseKey}});
  assert.deepEqual(headers,[{OrderYear:'2026',OrderWeek:'47-01',FarmName:'NZ Blooms',InvoiceNo:'210195'}]);
  assert.deepEqual(rows.map(r=>[r.BoxQuantity,r.BunchQuantity,r.SteamQuantity,r.SteamOf1Box,r.SteamOf1Bunch,r.OutQuantity,r.EstQuantity,r.UPrice,r.TPrice]),[
    [3,48,240,80,5,48,48,7.57,1816.8],
    [2,40,200,100,5,200,200,4.7,940],
    [3,60,300,100,5,300,300,4.99,1497],
  ]);
  assert.equal((await documents.getInvoiceDocument({queryFn:ctx.queryFn,types:sql,documentId:doc.documentId})).rawMetadata.currency,'NZD');
  assert.equal(invoiceAmountReview(draft).difference,0);
  assert.equal((await ctx.create(args)).warehouseKey,result.warehouseKey);
  await assert.rejects(()=>ctx.create({...args,operationId:crypto.randomUUID(),receiptPartId:crypto.randomUUID()}));
  assert.deepEqual(await protectedSnapshot(pool),before);
  console.log(JSON.stringify({warehouseKey:result.warehouseKey,rows:rows.length,first:rows[0],farm:headers[0].FarmName,totalNZD:4253.8,difference:0,
    duplicateReplay:true,newDuplicateBlocked:true,units:'TEST_ONLY stems, not production evidence'}));
};
