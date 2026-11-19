// Actual SQL writer + real browser workflow; only the guarded disposable loopback DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=async function(all){
 const {pool,sql,query,ctx,protectedSnapshot}=all;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const {mergePackingChunks}=await import('../lib/importPackingPdfChunks.js');
 const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const out=path.resolve('.verify/amount-receipt-e2e');fs.mkdirSync(out,{recursive:true});
 let pdfPath=process.env.NENOVA_AMOUNT_REVIEW_SOURCE_PDF;
 if(!pdfPath){const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();for(let i=1;i<=7;i++)pdf.addPage().drawText('TEST_ONLY reconstructed invoice 18065 / page '+i);pdfPath=path.join(out,'47-2 TEST_ONLY invoice.pdf');fs.writeFileSync(pdfPath,await pdf.save());}
 const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex');
 if(process.env.NENOVA_AMOUNT_REVIEW_SOURCE_PDF)assert.equal(sourceHash,'b2176913b2a9f15d3e33354a0b4ad0e4f9956db8919c1f7de38947a6cf3a548c');
 const products=[1,2,2,3,14,3,1,1].map((pcs,i)=>({description:'CARNATION TEST_ONLY '+(i+1),pcs,steam_box:300,bunch_st:20,total_bunch:pcs*15,total_stems:pcs*300,u_price:.215,t_price:pcs*64.5,source_page:6}));
 const invoice={supplier:'TEST_ONLY Grower',invoice:'18065',currency:'USD',date:'2026-11-18',raw_date:'18/11/2026',date_order:'DMY',date_kind:'invoice',invoice_total:1741.5,freight_total:0,products:[...products,{description:'CARNATION CARNATION CARNATION',pcs:27,total_bunch:405,total_stems:8100,u_price:.215,t_price:1741.5,source_page:7}]};
 const pageCount=process.env.NENOVA_AMOUNT_REVIEW_SOURCE_PDF?28:7;
 const ai=mergePackingChunks([{pages:Array.from({length:pageCount},(_,i)=>i+1),result:{invoices:[invoice]}}],pageCount,{sourceHash,reviewRecoverable:true});
 const raw=products.map((p,i)=>({ProdKey:93001+i,ProdName:p.description,CountryFlower:'TEST_CO_CARNATION',CounName:'콜롬비아',FlowerName:'카네이션',OutUnit:'단',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300}));
 for(const p of raw){const params={};for(const[k,v]of Object.entries(p))params[k]={type:typeof v==='number'?sql.Float:sql.NVarChar,value:v};params.ProdKey.type=sql.Int;
  await query(pool,`INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted) VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0);`,params);}
 await query(pool,`INSERT dbo.Country(CounName,isUseOrderCode) VALUES(N'콜롬비아',0); INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7111,N'TEST_ONLY Grower',2,0); UPDATE dbo.StockMaster SET OrderWeek=N'47-02',OrderYearWeek=OrderYear+N'4702' WHERE StockKey IN (2501,2601); CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));`);
 await query(pool,'ALTER TABLE dbo.Country ADD CounKey int NULL;');
 await query(pool,"UPDATE dbo.Country SET CounKey=CASE WHEN CounName=N'콜롬비아' THEN 2 ELSE 1 END;");
 let au=null;const auRaw={ProdKey:94001,ProdName:'TEST_ONLY AU GREENS',CountryFlower:'TEST_AU',CounName:'호주',FlowerName:'그린',OutUnit:'단',EstUnit:'단',BunchOf1Box:10,SteamOf1Bunch:10,SteamOf1Box:100};
 if(process.env.NENOVA_AMOUNT_REVIEW_AWB_PDF){
  const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();pdf.addPage().drawText('TEST_ONLY AU INVOICE 2026 44-01 / AWB 081-63688774 / 65 BOX / AUD650');
  const bytes=await pdf.save(),file=path.join(out,'44-01 TEST_ONLY AU invoice.pdf');fs.writeFileSync(file,bytes);
  const awbSourceHash=crypto.createHash('sha256').update(fs.readFileSync(process.env.NENOVA_AMOUNT_REVIEW_AWB_PDF)).digest('hex');
  const auInvoice={supplier:'TEST_ONLY AU Grower',invoice:'TEST-AU-4401',date:'2026-10-27',raw_date:'27/10/2026',date_order:'DMY',date_kind:'invoice',currency:'AUD',awb:'081-63688774',invoice_total:650,freight_total:0,products:[{description:auRaw.ProdName,pcs:65,total_bunch:650,total_stems:6500,bunch_st:10,steam_box:100,u_price:1,t_price:650,source_page:1}]};
  const awb={awb:'081-63688774',invoice_awb:'081-63688774',packages:65,gross_weight_kg:805,chargeable_weight_kg:805,currency:'AUD',evidence:Object.fromEntries([['awb','Air Waybill 081-63688774'],['packages','Total pieces 65'],['gross_weight_kg','Gross Weight 805 kg'],['chargeable_weight_kg','Chargeable Weight 805 kg']].map(([k,quote])=>[k,{page:1,quote}]))};
  au={country:'AU',sourceHash:crypto.createHash('sha256').update(bytes).digest('hex'),awbSourceHash,ai:{content:[{type:'text',text:JSON.stringify({invoices:[auInvoice],awb_document:awb})}],stop_reason:'end_turn'}};
  await query(pool,"INSERT dbo.Country(CounName,isUseOrderCode,CounKey) VALUES(N'호주',0,3); INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7112,N'TEST_ONLY AU Grower',3,0); INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID) VALUES(4401,N'2025',N'44-01',N'20254401',1,N'fixture'),(4402,N'2026',N'44-01',N'20264401',1,N'fixture'); INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted) VALUES(94001,N'TEST_ONLY AU GREENS',N'TEST_AU',N'호주',N'그린',N'단',N'단',10,10,100,0,0);");
  console.log('TEST_ONLY AU invoice='+file+'; actual AWB source hash='+awbSourceHash);
 }
 const catalog={products:packingErpProducts([...raw,...(au?[auRaw]:[])]),value:{version:1,entries:[]},revision:1};
 products.forEach((p,i)=>catalog.value=upsertPackingErpMatch(catalog.value,{country:'CO',description:p.description,prodKey:raw[i].ProdKey},catalog.products));
 if(au)catalog.value=upsertPackingErpMatch(catalog.value,{country:'AU',description:auRaw.ProdName,prodKey:94001},catalog.products);
 const protectedBefore=await protectedSnapshot(pool);
 console.log('TEST_ONLY actual source PDF; reconstructed response, NOT employee saved response. PDF='+pdfPath);
 const run=await require('./test-packing-native-local.cjs')({...all,protectedBefore,catalog,upsertPackingErpMatch,farms:[{FarmKey:7111,FarmName:'TEST_ONLY Grower'},...(au?[{FarmKey:7112,FarmName:'TEST_ONLY AU Grower'}]:[])],cachedAnalysis:{country:'CO',sourceHash,ai,alternates:au?{AU:au}:{},testRate:{currency:'USD',rate:1400,marketRate:1385,adjustmentKRW:15,rateType:'TEST_ONLY',source:'TEST_ONLY fixed rate',quoteAt:new Date().toISOString(),requestedAt:new Date().toISOString()}}});
 assert.equal(run.receiptRequests.length,au?2:1,'one explicit receipt submission per invoice');let first;
 for(const entry of run.receiptRequests){const h=(await query(pool,'SELECT InvoiceNo FROM dbo.WarehouseMaster WHERE WarehouseKey=@key',{key:{type:sql.Int,value:entry.result.warehouseKey}})).recordset[0];if(h.InvoiceNo==='18065')first=entry;}
 assert(first,'CO receipt must exist');
 const before=(await query(pool,'SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=@key ORDER BY WdetailKey',{key:{type:sql.Int,value:first.result.warehouseKey}})).recordset;
 assert.equal(before.length,8);assert.equal(before.reduce((s,r)=>s+r.BoxQuantity,0),27);assert.equal(before.reduce((s,r)=>s+r.BunchQuantity,0),405);assert.equal(before.reduce((s,r)=>s+r.SteamQuantity,0),8100);assert.equal(before.reduce((s,r)=>s+r.TPrice,0),1741.5);
 const replay=await ctx.create(first.args);assert.equal(replay.warehouseKey,first.result.warehouseKey);
 await assert.rejects(()=>ctx.create({...first.args,operationId:crypto.randomUUID(),receiptPartId:crypto.randomUUID()}),e=>['SPLIT_RECEIPT_NOT_SUPPORTED','ALREADY_RECEIVED','REVISION_ALREADY_COMMITTED','RECEIPT_ALREADY_COMMITTED','STALE_BASELINE'].includes(e.code));
 assert.deepEqual((await query(pool,'SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=@key ORDER BY WdetailKey',{key:{type:sql.Int,value:first.result.warehouseKey}})).recordset,before);
 assert(run.events.some(e=>e.route.endsWith('/cost-export')&&e.status===200&&e.bytes>10000),'same receipt cost XLSX downloaded');
 const evidence={pass:true,sourceHash,actualSourcePdf:!!process.env.NENOVA_AMOUNT_REVIEW_SOURCE_PDF,employeeSavedResponse:false,reconstructedResponse:true,warehouseKey:first.result.warehouseKey,goodsRows:8,boxes:27,bunches:405,stems:8100,goodsUSD:1741.5,duplicateReplaySameReceipt:true,newDuplicateBlocked:true,productionWrites:0,paidCalls:0,events:run.events};
 fs.writeFileSync(path.join(out,'readback.json'),JSON.stringify(evidence,null,2));console.log('PASS_AMOUNT_REVIEW_RECEIPT_COST',JSON.stringify(evidence));
};
