// Actual page-1 invoice values; isolated SQL only. Not an AI extraction accuracy test.
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs');
module.exports=async function({pool,sql,query,writer,documents,costs,ctx,protectedSnapshot}){
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const {resolveInvoiceHeader,applyInvoiceHeader}=await import('../lib/invoiceReceiptAutoFill.js');
 const {adaptPackingReceipts,toReceiptDraftPayload}=await import('../lib/importPackingReceiptAdapter.js');
 const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const {buildPackingMatchPreview}=await import('../lib/importPackingMatchPreview.js');
 const {exportCurrentInvoiceCost}=await import('../lib/invoiceReceiptCostExport.js');
 const sourceRows=[
  [871,'HYDRANGEA TINTED LAVANDER','Hydrangea Lavender (라벤더)',29,870,.9,783],
  [868,'HYDRANGEA TINTED HOT PINK','Hydrangea Hot Pink',4,120,.9,108],
  [878,'HYDRANGEA TINTED LIGHT PINK','Hydrangea P.PK (BA) (연핑크)',37,1110,.9,999],
  [881,'HYDRANGEA TINTED ROSEWOOD','Hydrangea Rosewood',2,60,.9,54],
  [866,'HYDRANGEA BLUE PREMIUM','Hydrangea Blue',5,150,.66,99],
  [2960,'HYDRANGEA TINTED SUPER LIGHT PINK','Hydrangea Super Light Pink',10,300,.9,270],
  [889,'HYDRANGEA WHITE PREMIUM','Hydrangea White',20,600,.7,420],
 ];
 const products=sourceRows.map(([ProdKey,,ProdName])=>({ProdKey,ProdName,CountryFlower:2000,CounName:'콜롬비아',FlowerName:'수국',OutUnit:'박스',EstUnit:'송이',BunchOf1Box:30,SteamOf1Bunch:1,SteamOf1Box:30}));
 const invoice={invoice:'25529',supplier:'CI FLORES BALVERDE SAS',date:'2026-10-23',raw_date:'23OCT2026',date_kind:'invoice',currency:'USD',awb:'160-96630575',invoice_total:2733,gross_weight:759.7,
  products:sourceRows.map(([,description,,pcs,total_stems,u_price,t_price])=>({description,pcs,total_stems,total_bunch:total_stems,bunch_st:1,steam_box:30,u_price,t_price}))};
 const catalog={products:packingErpProducts(products),value:{version:1,entries:[]},revision:1};
 sourceRows.forEach(([prodKey,description])=>{catalog.value=upsertPackingErpMatch(catalog.value,{country:'CO',description,prodKey},catalog.products);});
 await query(pool,"INSERT dbo.Country(CounName,isUseOrderCode) VALUES(N'콜롬비아',0); INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(41,N'Balverde',2,0); UPDATE dbo.StockMaster SET OrderWeek=N'44-01',OrderYearWeek=OrderYear+N'4401' WHERE StockKey IN (2501,2601);");
 for(const p of products){const params={};for(const[k,v]of Object.entries(p))params[k]={type:typeof v==='number'?sql.Int:sql.NVarChar,value:v};
  await query(pool,`INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted) VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0)`,params);
 }
 const before=await protectedSnapshot(pool);
 if(process.env.NENOVA_44_BROWSER_TEST==='1'){
  await query(pool,'CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));');
  const pdf='C:/Users/USER/Documents/카카오톡 받은 파일/44-1 콜수국 CI.pdf';
  console.log('TEST_ONLY: original PDF hash checked, page 1 transcription fixture; other 11 pages and AI recognition are NOT under test');
  return require('./test-packing-native-local.cjs')({pool,sql,query,writer,documents,ctx,protectedSnapshot,protectedBefore:before,catalog,upsertPackingErpMatch,farms:[{FarmKey:41,FarmName:'Balverde'}],cachedAnalysis:{country:'CO',sourceHash:createHash('sha256').update(fs.readFileSync(pdf)).digest('hex'),ai:{content:[{type:'text',text:JSON.stringify({invoices:[invoice]})}],stop_reason:'end_turn'}}});
 }
 const sourceHash=createHash('sha256').update('44-01 invoice25529 source transcription v1').digest('hex');
 const excels=buildPackingMatchPreview({invoices:[invoice],country:'CO',erpMatches:catalog});
 let draft=(await adaptPackingReceipts({sourceHash,country:'CO',fileName:'2026 44-1 콜수국.xlsx',invoices:[invoice],excels,products:catalog.products,reviewConfirmed:true}))[0];
 draft=applyInvoiceHeader({document:draft},resolveInvoiceHeader(draft,[{FarmKey:41,FarmName:'Balverde'}])).document;
 assert.equal(draft.reviewedMetadata.inputDate,'2026-10-23');assert.equal(draft.farmKey,41);
 draft.reviewedMetadata.transportMode='AIR';draft.reviewedMetadata.gw=759.7;draft.reviewedMetadata.cw=759.7; // CW is TEST_ONLY, not printed GW inference.
 draft.reviewedMetadata.receiptNotes='TEST_ONLY CW=GW; existing ERP matching selected for comparison, no shared learning';
 const saved=await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,actor:'invoice-fixture',input:toReceiptDraftPayload(draft)});
 const preview=await ctx.preview(saved.documentId,saved.revision);assert.equal(preview.canCommit,true,JSON.stringify(preview.issues));
 const commit=await ctx.create({documentId:saved.documentId,revision:saved.revision,operationId:randomUUID(),receiptPartId:randomUUID(),baselineDigest:preview.baselineDigest,reason:'TEST_ONLY 44-1 source comparison',allowPendingCost:true,actor:'invoice-fixture'});
 const detail=(await query(pool,'SELECT ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,UPrice,TPrice FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk',{wk:{type:sql.Int,value:commit.warehouseKey}})).recordset;
 for(const [key,, ,box,stem,price,amount]of sourceRows){const row=detail.find(r=>r.ProdKey===key);assert.deepEqual([row.BoxQuantity,row.BunchQuantity,row.SteamQuantity,row.UPrice,row.TPrice],[box,stem,stem,price,amount]);}
 assert.equal(detail.reduce((s,r)=>s+r.BoxQuantity,0),107);
 const formula=costs.INVOICE_COST_FORMULAS.CO_GROUP_42_1_V1;
 const cost=await costs.saveInvoiceCostRevision({withTransactionFn:ctx.withTransactionFn,types:sql,documentId:saved.documentId,revision:saved.revision,actor:'invoice-fixture',reason:'TEST_ONLY download, not real cost',input:{...formula,formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-23',nativeCurrency:'USD',freightCurrency:'USD',exchangeRateKRW:1400,exchangeRateType:'TEST_ONLY',exchangeRateDate:'2026-10-23',freightAmount:100,customsTotalKRW:10000,expenseBasis:'ESTIMATED',estimateSource:'TEST_ONLY 시험값',costSourceId:'TEST_ONLY:'+saved.documentId,allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,costGroups:[{groupId:'HYDRANGEA',quantity:3210,boxQuantity:107,grossWeightKg:759.7,volumeWeightKg:759.7}],lineInputs:saved.lines.map(l=>({lineId:l.lineId,tariffRate:0,groupId:'HYDRANGEA',stemsPerBunch:1,bunchesPerBox:30}))}});
 const out=await exportCurrentInvoiceCost({queryFn:ctx.queryFn,types:sql,documentId:saved.documentId,warehouseKey:String(commit.warehouseKey),costRevisionId:cost.currentActual.costRevisionId});
 assert.ok(out.buffer.length>1000);assert.deepEqual(await protectedSnapshot(pool),before);
 // An alternate spelling must not bypass duplicate checking, in either preview or commit.
 await query(pool,'UPDATE dbo.WarehouseMaster SET FarmName=N\'C.I Flores Balverde S.A.S\' WHERE WarehouseKey=@wk',{wk:{type:sql.Int,value:commit.warehouseKey}});
 const other={...draft,documentId:randomUUID(),sourceHash:createHash('sha256').update('alternate source').digest('hex'),lines:draft.lines.map(l=>({...l,lineId:randomUUID()}))};
 await assert.rejects(documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,actor:'invoice-fixture',input:toReceiptDraftPayload(other)}),{code:'INVOICE_BUSINESS_KEY_CONFLICT'});
 // Simulate a native legacy receipt with no web business-key index, fixture only.
 await query(pool,'UPDATE dbo.WebInvoiceDocument SET BusinessKeyHash=NULL WHERE DocumentId=@id',{id:{type:sql.UniqueIdentifier,value:saved.documentId}});
 const duplicate=await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,actor:'invoice-fixture',input:toReceiptDraftPayload(other)});
 const blocked=await ctx.preview(duplicate.documentId,duplicate.revision);assert.ok(blocked.issues.some(i=>i.code==='DUPLICATE_INVOICE'));
 console.log('PASS 44-01 invoice25529: auto farm/date -> actual isolated SQL receipt 7 lines/107 boxes/3210 stems/USD2733 -> TEST_ONLY cost export',out.buffer.length,'bytes; alternate farm duplicate blocked; protected ERP unchanged');
};
