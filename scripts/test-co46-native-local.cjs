// Isolated SQL/browser workflow fixture. Source transcription is NOT an AI accuracy claim.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
module.exports=async function(all){
 const {pool,sql,query,protectedSnapshot}=all;
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);
 assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const rows=JSON.parse(fs.readFileSync(process.env.NENOVA_CO46_RECEIPTS,'utf8')).filter(r=>r.OrderYear==='2026'&&r.OrderWeek==='46-01'&&String(r.OrderNo).replace(/[- ]/g,'')==='16017338020');
 assert.equal(rows.length,46);
 assert.equal(rows.reduce((s,r)=>s+r.BoxQuantity,0),662);
 assert.equal(rows.reduce((s,r)=>s+r.SteamQuantity,0),19960);
 assert.ok(Math.abs(rows.reduce((s,r)=>s+r.TPrice,0)-13366.76)<0.001);
 const {packingErpProducts,upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const products=[...new Map(rows.map(r=>[r.ProdKey,r])).values()].map(r=>({...r,CountryFlower:2000,EstUnit:'송이',BunchOf1Box:r.SteamOf1Box/r.SteamOf1Bunch}));
 const catalog={products:packingErpProducts(products),value:{version:1,entries:[]},revision:1};
 for(const p of products){
  const params={};for(const k of ['ProdKey','ProdName','CountryFlower','CounName','FlowerName','OutUnit','EstUnit','BunchOf1Box','SteamOf1Bunch','SteamOf1Box'])params[k]={type:k==='ProdKey'?sql.Int:typeof p[k]==='number'?sql.Float:sql.NVarChar,value:p[k]};
  await query(pool,'INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted) VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0)',params);
  catalog.value=upsertPackingErpMatch(catalog.value,{country:'CO',description:p.ProdName,prodKey:p.ProdKey},catalog.products);
 }
 await query(pool,"INSERT dbo.Country(CounName,isUseOrderCode) VALUES(N'콜롬비아',0); UPDATE dbo.StockMaster SET OrderWeek='46-01',OrderYearWeek=OrderYear+'4601' WHERE StockKey IN(2501,2601); CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));");
 const groups=[...new Map(rows.map(r=>[r.WarehouseKey,rows.filter(x=>x.WarehouseKey===r.WarehouseKey)])).values()];assert.equal(groups.length,16);
 const farms=[],invoices=[];
 for(const [i,group]of groups.entries()){
  const first=group[0],farm={FarmKey:7200+i,FarmName:first.FarmName};farms.push(farm);
  await query(pool,'INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(@key,@name,2,0)',{key:{type:sql.Int,value:farm.FarmKey},name:{type:sql.NVarChar,value:farm.FarmName}});
  invoices.push({supplier:first.FarmName,invoice:first.InvoiceNo,date:'2026/11/06',date_order:'YMD',date_kind:'invoice',currency:'USD',awb:'160-17338020',freight_total:0,invoice_total:group.reduce((s,r)=>s+r.TPrice,0),products:group.map((r,n)=>({description:r.ProdName,source_row:n+1,pcs:r.BoxQuantity,total_bunch:r.BunchQuantity,total_stems:r.SteamQuantity,bunch_st:r.SteamOf1Bunch,u_price:r.UPrice,t_price:r.TPrice}))});
 }
 const sourceHash=createHash('sha256').update(fs.readFileSync(process.env.NENOVA_CO46_PDF)).digest('hex');
 console.log('TEST_ONLY source-reviewed receipt comparison fixture: 16 invoices / 46 rows; no AI extraction accuracy claim; no production forwarding.');
 await require('./test-packing-native-local.cjs')({...all,protectedBefore:await protectedSnapshot(pool),catalog,upsertPackingErpMatch,farms,cachedAnalysis:{country:'CO',sourceHash,ai:{content:[{type:'text',text:JSON.stringify({master_awb:'160-17338020',invoices})}],stop_reason:'end_turn'}}});
};
