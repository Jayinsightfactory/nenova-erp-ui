// Private source inputs stay outside git. Only the invocation-owned loopback DB is writable.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
module.exports=async function(all){
 const {pool,sql,query,protectedSnapshot}=all;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);
 assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const source=JSON.parse(fs.readFileSync(process.env.NENOVA_CN45_SOURCE));
 const catalog=JSON.parse(fs.readFileSync(process.env.NENOVA_CN45_CATALOG));
 const products=JSON.parse(fs.readFileSync(process.env.NENOVA_CN45_PRODUCTS));
 const country=process.env.NENOVA_BATCH_COUNTRY||'CN';
 const countryName={CN:'중국',NL:'네덜란드',CO:'콜롬비아',TH:'태국',AU:'호주',US:'미국',EC:'에콰도르',VN:'베트남'}[country];
 assert.ok(countryName);assert.equal(source.country,country);assert.equal(source.sourceHash,createHash('sha256').update(Buffer.from(source.fileBase64,'base64')).digest('hex'));
 const {upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 for(const p of products.filter(p=>p.CounName===countryName)){
  const params={};for(const k of ['ProdKey','ProdName','CountryFlower','CounName','FlowerName','OutUnit','EstUnit','BunchOf1Box','SteamOf1Bunch','SteamOf1Box','TariffRate'])params[k]={type:k==='ProdKey'?sql.Int:typeof p[k]==='number'?sql.Float:sql.NVarChar,value:p[k]??null};
  await query(pool,`IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ProdKey=@ProdKey)
   INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,TariffRate,Stock,isDeleted)
   VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,@TariffRate,0,0);`,params);
 }
 await query(pool,`INSERT dbo.WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,isDeleted) VALUES(99111,'2025','45-01','HUBFRESH','TEST_ONLY_PRIOR_YEAR',0);
 UPDATE dbo.StockMaster SET OrderWeek='45-01',OrderYearWeek=OrderYear+'4501' WHERE StockKey IN(2501,2601);
 CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));`);
 if(process.env.NENOVA_BATCH_WEEK){
  const week=process.env.NENOVA_BATCH_WEEK;assert.match(week,/^\d{2}-\d{2}$/);
  await query(pool,"UPDATE dbo.StockMaster SET OrderWeek=@week,OrderYearWeek=OrderYear+REPLACE(@week,'-','') WHERE StockKey IN(2501,2601)",{week:{type:sql.NVarChar,value:week}});
 }
 const protectedBefore=await protectedSnapshot(pool);
 // Keep the actual cached extraction (including recognition errors) for UI reproduction.
 const ai={content:[{type:'text',text:JSON.stringify(source.snapshot.lastExtraction.result)}],stop_reason:'end_turn'};
 console.log('CN45: original cached extraction, shared mappings copied read-only; no production API forwarding.');
 const farms=country==='CN'?[]:[...new Set(source.snapshot.lastExtraction.result.invoices.map(i=>i.supplier).filter(Boolean))].map((FarmName,i)=>({FarmKey:7200+i,FarmName}));
 for(const farm of farms)await query(pool,'INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(@key,@name,1,0)',{key:{type:sql.Int,value:farm.FarmKey},name:{type:sql.NVarChar,value:farm.FarmName}});
 return require('./test-packing-native-local.cjs')({...all,protectedBefore,catalog,upsertPackingErpMatch,farms,cachedAnalysis:{country,sourceHash:source.sourceHash,ai}});
};
