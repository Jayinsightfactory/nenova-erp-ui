const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),sql=require('mssql');
const fixture=require('./test-weekday-distribution-sql.cjs');
(async()=>{
const name='NenovaEstimateFixture_'+new Date().toISOString().slice(0,10).replaceAll('-','')+'_'+crypto.randomBytes(4).toString('hex');fixture.assertDbName(name);
const config={server:'127.0.0.1',port:14339,database:'master',user:'sa',password:'local-fixture',options:{encrypt:false,trustServerCertificate:true}};
const master=await new sql.ConnectionPool(config).connect();let pool;
try{
 await fixture.query(master,`CREATE DATABASE [${name}]`);pool=await new sql.ConnectionPool({...config,database:name}).connect();await fixture.installSchema(pool);await fixture.seed(pool);
 const q=(s,p)=>fixture.query(pool,s,p);
 for(const kind of ['ShipmentFix','ShipmentFixCancel'])for(const batch of fs.readFileSync(`docs/migrations/backup_usp_${kind}_2026-08-23_before_stock_week_gate.sql`,'utf8').split(/^\s*GO\s*;?\s*$/gim).filter(s=>s.trim()))await q(batch);
 await q(`INSERT Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Box,SteamOf1Bunch,Cost,Stock) VALUES(901,N'Douglas',N'US Douglas',N'US',N'Douglas',N'박스',N'단',30,30,1,100,0),(902,N'Lemon',N'US Lemon',N'US',N'Lemon',N'박스',N'단',30,30,1,100,0);
 INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix) VALUES(901,6266,533,901,'2026-09-10',1,1,30,30,30,100,3000,300,0),(902,6266,533,902,'2026-09-10',1,1,30,30,30,100,3000,300,0);`);
 await q(`INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted) VALUES(9010,N'2025',N'37-01',N'202537',533,1,0);
 INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix) VALUES(9010,9010,533,866,'2025-09-10',2,2,60,60,60,100,6000,600,1);`);
 const preserved=async()=>JSON.stringify({estimate:(await q('SELECT * FROM Estimate ORDER BY EstimateKey')).recordset,farms:(await q('SELECT * FROM ShipmentFarm ORDER BY FarmKey,SdetailKey')).recordset,prior:(await q('SELECT * FROM ShipmentDetail WHERE ShipmentKey=9010')).recordset,orders:(await q('SELECT * FROM OrderDetail ORDER BY OrderDetailKey')).recordset,dates:(await q('SELECT * FROM ShipmentDate ORDER BY SdateKey')).recordset,target:(await q('SELECT OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat FROM ShipmentDetail WHERE SdetailKey=89892')).recordset});
 const before=await preserved();
 const db={query:q,sql,withTransaction:async fn=>{const tx=new sql.Transaction(pool);await tx.begin();try{const result=await fn(fixture.tQuery(tx));await tx.commit();return result;}catch(e){await tx.rollback();throw e;}}};
 const api=require('./load-isolated-erp-api.cjs')('pages/api/shipment/fix.js',db);
 const call=async(action,scoped)=>{let status=200,data;const res={status(v){status=v;return this;},json(v){data=v;return this;},setHeader(){},end(){}};await api({method:'POST',query:{},headers:{},body:{week:'2026-37-01',orderYear:'2026',action,force:false,countryFlowers:['Colombia Carnation'],stockProdKeys:[866],...(scoped?{distributionEditProdKeys:[866],cycleSource:'distribute-save'}:{})},user:{userId:'fixture-user',authority:2}},res);console.log('actual fix API',action,scoped,status,JSON.stringify(data));return {status,data};};
 const initial=JSON.stringify((await q('SELECT ProdKey,OutQuantity,Amount,Vat,isFix FROM ShipmentDetail WHERE ProdKey IN(901,902) ORDER BY ProdKey')).recordset);
 const unfix=await call('unfix',true);assert.equal(unfix.data.success,true);
 const ordinary=await call('fix',false);assert.equal(ordinary.data.code,'PARTIAL_CATEGORY_FIX_BLOCKED');
 const refix=await call('fix',true);assert.equal(refix.data.success,true);
 assert.equal(Number((await q('SELECT isFix FROM ShipmentDetail WHERE SdetailKey=89892')).recordset[0].isFix),1);
 assert.equal(JSON.stringify((await q('SELECT ProdKey,OutQuantity,Amount,Vat,isFix FROM ShipmentDetail WHERE ProdKey IN(901,902) ORDER BY ProdKey')).recordset),initial);
 assert.equal(await preserved(),before,'Prior year, orders, dates, target quantities and money preserved');
 console.log('PASS actual fix/unfix API + native SP: edited category restored; two unrelated US groups unchanged; ordinary partial guard retained');
 // Manual toolbar retains the ordinary partial-fix guard. Make unrelated fixture
 // categories already fixed, then verify target-only native cancel/confirm.
 await q('UPDATE ShipmentDetail SET isFix=1 WHERE ProdKey IN(901,902)');
 await q(`INSERT WarehouseDetail(WdetailKey,WarehouseKey,ProdKey,FarmKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch) VALUES(901,3701,901,NULL,2,60,60,2,60,1,60,30,1),(902,3701,902,NULL,2,60,60,2,60,1,60,30,1)`);
 const toolbar=async(action,categories=['Colombia Carnation'],selection={prodGroup:'Colombia::Carnation',prodKey:866})=>{
  let status=200,data;await api({method:'POST',query:{},headers:{},body:{week:'2026-37-01',orderYear:'2026',action,force:false,countryFlowers:categories,cycleSource:'distribute-toolbar',confirmationSelection:selection},user:{userId:'fixture-user',authority:2}},{status(n){status=n;return this},json(v){data=v;return this},setHeader(){},end(){}});console.log("toolbar",action,status,JSON.stringify(data));return {status,data};
 };
 const statusApi=require('./load-isolated-erp-api.cjs')('pages/api/shipment/distribution-confirmation.js',db);
 const status=async(year='2026',group='Colombia::',prodKey)=>{let result;await statusApi({method:'GET',query:{week:year+'-37-01',year,prodGroup:group,...(prodKey?{prodKey:String(prodKey)}:{})}},{setHeader(){},status(){return this},json(d){result=d;return this}});return result;};
 assert.deepEqual((await status('2026','',866)).categories,['Colombia Carnation']);
 assert.equal((await status('2026','',866)).rows.find(r=>r.category==='Colombia Carnation').status,'FIXED');
 const blocked=await toolbar('unfix',[],null);assert.notEqual(blocked.data.success,true);
 const wrong=await toolbar('unfix',['US Douglas']);assert.notEqual(wrong.data.success,true);
 assert.equal((await toolbar('unfix')).data.success,true);
 assert.equal((await status('2026','',866)).rows.find(r=>r.category==='Colombia Carnation').status,'UNFIXED');
 assert.equal(Number((await q('SELECT isFix FROM ShipmentDetail WHERE SdetailKey=9010')).recordset[0].isFix),1);
 assert.equal((await toolbar('fix')).data.success,true);
 assert.equal((await status('2026','',866)).rows.find(r=>r.category==='Colombia Carnation').status,'FIXED');
 assert.deepEqual((await q('SELECT isFix FROM ShipmentDetail WHERE ProdKey IN(901,902)')).recordset.map(r=>Number(r.isFix)),[1,1]);
 assert.equal(await preserved(),before);
 console.log('PASS toolbar actual production GET/POST + native SP: read fixed -> cancel -> read unfixed -> confirm -> read fixed, scope mismatch/empty rejected; unrelated/year/quantities/money/order/date preserved');

}finally{await pool?.close();await fixture.query(master,`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${name}]`);await master.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
