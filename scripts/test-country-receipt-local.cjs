const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
module.exports=async function(ctxAll){
 const {pool,sql,query,documents,costs,ctx,protectedSnapshot}=ctxAll;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const country=process.env.NENOVA_TEST_COUNTRY;assert.ok(['AU','US'].includes(country));
 const week='41-01';
 const root=path.resolve(process.env.NENOVA_COUNTRY_FIXTURE_ROOT);
 const {parsePackingResponse}=await import('../lib/importPackingResponse.js');
 const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const {buildPackingMatchPreview}=await import('../lib/importPackingMatchPreview.js');
 const {adaptPackingReceipts}=await import('../lib/importPackingReceiptAdapter.js');
 const {applyInvoiceAllocation}=await import('../lib/invoiceProductAllocation.js');
 const {exportCurrentInvoiceCost}=await import('../lib/invoiceReceiptCostExport.js');
 const ai=JSON.parse(fs.readFileSync(path.join(root,country+'.ai.json')));
 const parsed=parsePackingResponse(ai,country);assert.equal(parsed.wasTruncated,false);
 const invoice=parsed.result.invoices[0];
 const rawProducts=JSON.parse(fs.readFileSync(path.join(root,'product-probe.json')));
 const catalog={products:packingErpProducts(rawProducts),value:{version:1,entries:[]},revision:1};
 const keys=country==='AU'?[251,717,823,719,2999,1742,723]:[1718];
 invoice.products.slice(0,keys.length).forEach((row,i)=>{catalog.value=upsertPackingErpMatch(catalog.value,{country,description:row.description,prodKey:keys[i]},catalog.products);});
 // AU Copper Glow / Woolly choices are explicit test scenarios, not shared production learning.
 const countryName=country==='AU'?'호주':'미국';
 for(const p of rawProducts.filter(p=>p.CounName===countryName)){
  const params={};for(const k of ['ProdKey','ProdName','CountryFlower','CounName','FlowerName','OutUnit','EstUnit','BunchOf1Box','SteamOf1Bunch','SteamOf1Box'])params[k]={type:typeof p[k]==='number'?sql.Float:sql.NVarChar,value:p[k]};params.ProdKey.type=sql.Int;
  await query(pool,`INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted)
   VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0);`,params);
 }
 const farmName=country==='AU'?'Premium Greens':'Hood Canal';
 await query(pool,`INSERT dbo.Country(CounName,isUseOrderCode) VALUES(@country,0);
 INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7111,@farm,2,0);
 UPDATE dbo.StockMaster SET OrderWeek='${week}',OrderYearWeek=OrderYear+'${week.replace('-','')}' WHERE StockKey IN (2501,2601);
 CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));`,{country:{type:sql.NVarChar,value:countryName},farm:{type:sql.NVarChar,value:farmName}});
 const before=await protectedSnapshot(pool);
 const pdf=path.join('C:/Users/USER/Downloads',country==='AU'?'41-1 AUS CI.pdf':'41-1 US Hood Canal CI.pdf');
 const sourceHash=createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
 if(process.env.NENOVA_NATIVE_UI_TEST==='1')return require('./test-packing-native-local.cjs')({...ctxAll,protectedBefore:before,catalog,upsertPackingErpMatch,farms:[{FarmKey:7111,FarmName:farmName}],cachedAnalysis:{country,sourceHash,ai}});
 const previews=buildPackingMatchPreview({invoices:[invoice],country,erpMatches:catalog});
 let draft=(await adaptPackingReceipts({sourceHash,country,fileName:`2026 ${week}-${country}-reviewed.xlsx`,invoices:[invoice],excels:previews,products:catalog.products,reviewConfirmed:true}))[0];
 if(country==='AU'){
  for(const [index,source]of draft.rawMetadata.allocationSources.entries()){
   const row=draft.lines.find(line=>line.lineId===source.sourceLineId);
   draft=applyInvoiceAllocation(draft,source.sourceLineId,[{...row,prodKey:index===0?2997:2998}],catalog.products);
  }
 }
 const date='2026-10-12';
 const document=await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,actor:'invoice-fixture',input:{...draft,orderYear:'2026',orderWeek:week,invoiceYear:'2026',farmKey:7111,sourceHash,originalFileName:'TEST_ONLY '+path.basename(pdf),reviewedMetadata:{...draft.reviewedMetadata,country,farmName,transportMode:'AIR',inputDate:date},reason:'TEST_ONLY existing receipt comparison; no production learning'}});
 const preview=await ctx.preview(document.documentId,document.revision);assert.equal(preview.canCommit,true,JSON.stringify(preview.issues));
 await ctx.create({documentId:document.documentId,revision:document.revision,operationId:randomUUID(),receiptPartId:randomUUID(),baselineDigest:preview.baselineDigest,reason:'TEST_ONLY isolated country receipt',allowPendingCost:true,actor:'invoice-fixture'});
 const formula=costs.INVOICE_COST_FORMULAS[country==='AU'?'AU_CNF_BUNCH_V1':'US_CNF_BOX_V1'];
 const saved=await costs.saveInvoiceCostRevision({withTransactionFn:ctx.withTransactionFn,types:sql,documentId:document.documentId,revision:document.revision,actor:'invoice-fixture',reason:'TEST_ONLY download verification',input:{...formula,formulaApplicabilityConfirmed:true,formulaEffectiveDate:date,nativeCurrency:invoice.currency,freightCurrency:invoice.currency,exchangeRateKRW:country==='AU'?950:1400,exchangeRateType:'TEST_ONLY',exchangeRateDate:date,freightAmount:0,customsTotalKRW:10000,expenseBasis:'ESTIMATED',estimateSource:'TEST_ONLY 시험값 · 실제 원가 아님',costSourceId:'TEST_ONLY:'+document.documentId,allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
 lineInputs:document.lines.map(line=>({lineId:line.lineId,tariffRate:0,...{stemsPerBunch:line.bunchQuantity>0?line.stemQuantity/line.bunchQuantity:25,bunchesPerBox:line.boxQuantity>0&&line.bunchQuantity>0?line.bunchQuantity/line.boxQuantity:25}}))}});
 const out=await exportCurrentInvoiceCost({queryFn:ctx.queryFn,types:sql,documentId:document.documentId,warehouseKey:String(saved.warehouseKey),costRevisionId:saved.currentActual.costRevisionId});
 if(process.env.NENOVA_BOX_SUMMARY_TEST!=='1')fs.writeFileSync(path.join(root,`TEST_ONLY-${country}-${week}-cost.xlsx`),out.buffer);
 const readback=(await query(pool,'SELECT BoxQuantity,BunchQuantity,SteamQuantity,TPrice FROM WarehouseDetail WHERE WarehouseKey=@key',{key:{type:sql.Int,value:saved.warehouseKey}})).recordset;
 const totals=Object.fromEntries(['BoxQuantity','BunchQuantity','SteamQuantity','TPrice'].map(k=>[k,readback.reduce((s,r)=>s+Number(r[k]),0)]));
 assert.equal(totals.BoxQuantity,country==='AU'?56:70);assert.equal(totals.TPrice,country==='AU'?17706.25:4721.5);
 if(process.env.NENOVA_BOX_SUMMARY_TEST==='1')await require('./test-receipt-box-summary-local.cjs')({pool,ctx,sql},{country,week,warehouseKey:saved.warehouseKey,totals});
 assert.deepEqual(await protectedSnapshot(pool),before);
 if(process.env.NENOVA_BOX_SUMMARY_TEST!=='1')fs.writeFileSync(path.join(root,`${country}.local-e2e.json`),JSON.stringify({country,totals,receipt:true,cost:true,downloadBytes:out.buffer.length,costBasis:'TEST_ONLY',browserVerified:false,productionModified:false}));
 console.log('PASS',country,JSON.stringify(totals),'local receipt -> TEST_ONLY cost -> download');
};
