// Genuine AI response + read-only Product/Farm masters. Never reconstruct invoice rows from receipts.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
module.exports=async function(all){
 const {pool,sql,query,protectedSnapshot}=all;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const ai=JSON.parse(fs.readFileSync(process.env.NENOVA_CO46_AI_RESPONSE,'utf8'));
 const master=JSON.parse(fs.readFileSync(process.env.NENOVA_CO46_MASTER,'utf8'));
 const {parsePackingResponse}=await import('../lib/importPackingResponse.js');
 const parsed=parsePackingResponse(ai,'CO');assert.equal(parsed.wasTruncated,false);
 const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const catalog={products:packingErpProducts(master.products),value:process.env.NENOVA_CO46_SHARED_MATCHES
  ? JSON.parse(fs.readFileSync(process.env.NENOVA_CO46_SHARED_MATCHES,'utf8')) : {version:1,entries:[]},revision:1};
 for(const p of master.products){
  const params={};for(const k of ['ProdKey','ProdName','CountryFlower','CounName','FlowerName','OutUnit','EstUnit','BunchOf1Box','SteamOf1Bunch','SteamOf1Box'])params[k]={type:k==='ProdKey'?sql.Int:typeof p[k]==='number'?sql.Float:sql.NVarChar,value:p[k]??null};
  await query(pool,'INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted) VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0)',params);
 }
 await query(pool,"INSERT dbo.Country(CounName,isUseOrderCode) VALUES(N'콜롬비아',0); UPDATE dbo.StockMaster SET OrderWeek='46-01',OrderYearWeek=OrderYear+'4601' WHERE StockKey IN(2501,2601); CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));");
 for(const f of master.farms){
  if(f.FarmKey)await query(pool,'INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(@key,@name,2,0)',{key:{type:sql.Int,value:f.FarmKey},name:{type:sql.NVarChar,value:f.FarmName}});
  else await query(pool,"INSERT dbo.WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,isDeleted) VALUES(@key,'2025','46-01',@name,'FARM_NAME_REFERENCE_ONLY',0)",{key:{type:sql.Int,value:f.WarehouseKey},name:{type:sql.NVarChar,value:f.FarmName}});
 }
 const sourceHash=createHash('sha256').update(fs.readFileSync(process.env.NENOVA_CO46_PDF)).digest('hex');
 assert.equal(sourceHash,'d892c13ac311aefbd0f58fcc8c6f2724aef60493256922087215a929ec34b0cf');
 console.log('FRESH_AI_ONLY',JSON.stringify({invoices:parsed.result.invoices.length,rows:parsed.result.invoices.flatMap(i=>i.products).length,productMaster:master.products.length,receiptRowsUsed:false}));
 await require('./test-packing-native-local.cjs')({...all,protectedBefore:await protectedSnapshot(pool),catalog,upsertPackingErpMatch,farms:master.farms,cachedAnalysis:{country:'CO',sourceHash,ai}});
 const totals=(await query(pool,"SELECT COUNT(DISTINCT wm.WarehouseKey) receipts,COUNT(*) lines,SUM(wd.BoxQuantity) boxes,SUM(wd.SteamQuantity) stems,SUM(wd.TPrice) amount FROM dbo.WarehouseMaster wm JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey WHERE wm.OrderYear='2026' AND wm.OrderWeek='46-01' AND REPLACE(wm.OrderNo,'-','')='16017338020' AND wm.isDeleted=0")).recordset[0];
 console.log('ISOLATED_NEW_RECEIPT_TOTALS',JSON.stringify(totals));
 fs.writeFileSync('.verify/new-receipt-totals.json',JSON.stringify(totals));
};
