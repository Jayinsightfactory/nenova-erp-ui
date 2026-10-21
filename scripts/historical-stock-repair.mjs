// Manual operator tool. Default SELECT-only. Production requires approved hash + successful rehearsal.
// Credentials come from the process environment. Private evidence stays below .verify/.
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { createHash } from 'node:crypto';
import { planHistoricalStockRepair, stockRepairDigest, executeHistoricalStockRepair } from '../lib/historicalStockRepair.mjs';
import { runOrderStockCalculationBatch } from '../lib/orderStockCalculation.js';
import { executeOrderedHistoricalStockRepair, readStockCalculationMetadata, planStockCalculationOrderRepair } from '../lib/stockCalculationOrderRepair.mjs';

const requestFile=process.argv.find(a=>a.startsWith('--request='))?.slice(10);
if(!requestFile) throw Error('Private --request=.verify/file.json required');
const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
const {scope,expectedHash,actor}=request;
if (request.orderingFixApproved !== undefined && typeof request.orderingFixApproved !== 'boolean') throw Error('Explicit boolean ordering approval required');
const orderingFixApproved=request.orderingFixApproved===true;
if(!Array.isArray(scope?.prodKeys)||!scope.prodKeys.length||scope.prodKeys.length>20
  ||scope.prodKeys.some(k=>!Number.isInteger(k)||k<=0||k>2147483647)) throw Error('Invalid explicit product scope');
const keys=scope.prodKeys.join(',');
const mode=process.argv.includes('--apply')?'apply':process.argv.includes('--rehearse')?'rehearse':'preview';
const outputDir=path.resolve('.verify/historical-stock-repair');fs.mkdirSync(outputDir,{recursive:true});
const hashSql=(sqlText)=>`SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),(${sqlText} FOR JSON PATH,INCLUDE_NULL_VALUES))),2) AS Digest`;
const protectedQueries={
  stockMaster:`SELECT * FROM StockMaster ORDER BY StockKey`,
  otherStock:`SELECT StockKey,ProdKey,Stock FROM ProductStock WHERE ProdKey NOT IN (${keys}) ORDER BY StockKey,ProdKey`,
  otherStockHistory:`SELECT * FROM StockHistory WHERE ProdKey NOT IN (${keys}) OR ProdKey IS NULL ORDER BY StockHistoryKey`,
  orderMaster:`SELECT om.* FROM OrderMaster om WHERE EXISTS(SELECT 1 FROM OrderDetail od WHERE od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey IN (${keys})) ORDER BY om.OrderMasterKey`,
  orderDetail:`SELECT * FROM OrderDetail WHERE ProdKey IN (${keys}) ORDER BY OrderDetailKey`,
  shipmentMaster:`SELECT sm.* FROM ShipmentMaster sm WHERE EXISTS(SELECT 1 FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey IN (${keys})) ORDER BY sm.ShipmentKey`,
  shipmentDetail:`SELECT * FROM ShipmentDetail WHERE ProdKey IN (${keys}) ORDER BY SdetailKey`,
  shipmentHistory:`SELECT sh.* FROM ShipmentHistory sh JOIN ShipmentDetail sd ON sd.SdetailKey=sh.SdetailKey WHERE sd.ProdKey IN (${keys}) ORDER BY sh.SdetailKey,(SELECT sh.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)`,
  shipmentDate:`SELECT sdt.* FROM ShipmentDate sdt JOIN ShipmentDetail sd ON sd.SdetailKey=sdt.SdetailKey WHERE sd.ProdKey IN (${keys}) ORDER BY sdt.SdateKey`,
  shipmentFarm:`SELECT sf.* FROM ShipmentFarm sf JOIN ShipmentDetail sd ON sd.SdetailKey=sf.SdetailKey WHERE sd.ProdKey IN (${keys}) ORDER BY sf.SdetailKey,sf.FarmKey,sf.ShipmentQuantity`,
  estimate:`SELECT * FROM Estimate WHERE ProdKey IN (${keys}) ORDER BY EstimateKey`,
  warehouse:`SELECT wm.WarehouseKey AS HeaderKey,wm.OrderYear,wm.OrderWeek,wm.isDeleted,wd.* FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey WHERE wd.ProdKey IN (${keys}) ORDER BY wd.WdetailKey`,
  report:`SELECT * FROM WebProfitReport ORDER BY OrderYear,MajorWeek,Category,ColKey`,
  viewOrder:`SELECT * FROM ViewOrder WHERE ProdKey IN (${keys}) ORDER BY OrderDetailKey`,
  viewShipment:`SELECT * FROM ViewShipment WHERE ProdKey IN (${keys}) ORDER BY SdetailKey`,
};
async function readState(query){
  const get=async text=>(await query(text)).recordset;
  const masters=await get('SELECT StockKey,OrderYear,OrderWeek,OrderYearWeek FROM StockMaster ORDER BY OrderYearWeek,OrderWeek,StockKey');
  const stocks=await get(`SELECT StockKey,ProdKey,Stock FROM ProductStock WHERE ProdKey IN (${keys}) ORDER BY StockKey,ProdKey`);
  const products=await get(`SELECT * FROM Product WHERE ProdKey IN (${keys}) ORDER BY ProdKey`);
  const incoming=await get(`SELECT OrderYear,OrderWeek,ProdKey,OutQuantity FROM ViewWarehouse WHERE ProdKey IN (${keys}) ORDER BY OrderYear,OrderWeek,ProdKey,OutQuantity`);
  const outgoing=await get(`SELECT OrderYear,OrderWeek,ProdKey,OutQuantity FROM ViewShipment WHERE ProdKey IN (${keys}) AND DetailFix=1 ORDER BY OrderYear,OrderWeek,ProdKey,OutQuantity`);
  const adjustments=await get(`SELECT sh.*,(SELECT COUNT(*) FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType) TypeMatches FROM StockHistory sh WHERE ProdKey IN (${keys}) ORDER BY StockHistoryKey`);
  const definition=(await get("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')) Definition"))[0]?.Definition;
  if(!definition)throw Error('Native definition unavailable');
  const protectedState={};
  for(const [key,text] of Object.entries(protectedQueries))protectedState[key]=(await get(hashSql(text)))[0].Digest;
  const tables=await get("SELECT name FROM sys.tables WHERE name LIKE N'WebProfitReportConfirm%' ORDER BY name");
  for(const {name} of tables){
    if(!/^WebProfitReportConfirm\w*$/.test(name))throw Error('Unexpected snapshot table');
    // Stable row serialization sorted lexically, without assuming a historical schema PK.
    protectedState[name]=(await get(`SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),
      (SELECT (SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) AS row FROM [${name}] t
       ORDER BY (SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) FOR JSON PATH))),2) Digest`))[0].Digest;
  }
  return {masters,stocks,products,incoming,outgoing,adjustments,protected:protectedState,
    procedureHash:createHash('sha256').update(definition).digest('hex')};
}
const pool=await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:300000}).connect();
const query=async(text,params={},transaction)=>{
  const req=transaction?new sql.Request(transaction):pool.request();
  for(const [name,{type,value}] of Object.entries(params))req.input(name,type,value);
  return req.query(text);
};
try{
  if(mode==='preview'){
    const before=await readState(query),again=await readState(query);
    if(stockRepairDigest(before)!==stockRepairDigest(again))throw Error('Source changed during preview');
    fs.writeFileSync(path.join(outputDir,'before.json'),JSON.stringify(before));
    const plan=planHistoricalStockRepair(before,scope);
    const ordering=orderingFixApproved?planStockCalculationOrderRepair((await readStockCalculationMetadata(query)).definition):null;
    fs.writeFileSync(path.join(outputDir,'ordering-plan.json'),JSON.stringify(ordering&&{beforeHash:ordering.beforeHash,afterHash:ordering.afterHash}));
    fs.writeFileSync(path.join(outputDir,'plan.json'),JSON.stringify(plan,null,2));
    console.log(JSON.stringify({mode,sourceHash:plan.sourceHash,products:plan.items.length,changedSnapshots:plan.expected.filter(r=>r.before!==r.after).length,
      years:[...new Set(plan.expected.map(r=>r.OrderYear))],orderingFixApproved,businessWrites:0}));
  }else{
    const rehearsalPath=path.join(outputDir,'rehearsal.json');
    if(mode==='apply'){
      const rehearsal=JSON.parse(fs.readFileSync(rehearsalPath,'utf8'));
      if(rehearsal.sourceHash!==expectedHash||rehearsal.rollbackVerified!==true||rehearsal.scopeHash!==stockRepairDigest(scope)
        ||rehearsal.orderingFixApproved!==orderingFixApproved)throw Error('Matching rehearsal required');
      if(orderingFixApproved){
        const ordering=planStockCalculationOrderRepair((await readStockCalculationMetadata(query)).definition);
        if(rehearsal.ordering?.afterHash!==ordering.afterHash)throw Error('Matching ordering rehearsal required');
      }
    }
    const tx=new sql.Transaction(pool);let rolled=false,began=false,committing=false;
    tx.on('rollback',()=>{rolled=true});
    try{
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);began=true;
      const tq=(text,params)=>query(text,params,tx);
      await tq('SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;');
      const actorCheck=await tq('SELECT UserID FROM UserInfo WHERE UserID=@uid',{uid:{type:sql.NVarChar,value:actor}});
      if(actorCheck.recordset.length!==1)throw Error('Valid operator required');
      const executor=orderingFixApproved?executeOrderedHistoricalStockRepair:executeHistoricalStockRepair;
      const originalMetadata=orderingFixApproved?await readStockCalculationMetadata(tq):null;
      const result=await executor({tQuery:tq,types:sql,scope,expectedHash,readState,actor,orderingFixApproved,
        backup:async evidence=>fs.writeFileSync(path.join(outputDir,`procedure-backup-${mode}-${Date.now()}.json`),JSON.stringify(evidence,null,2),{flag:'wx'}),
        runNative:({tQuery,scope,actor})=>runOrderStockCalculationBatch({withTransactionFn:fn=>fn(tQuery),types:sql,
          orderYear:scope.year,orderWeek:scope.startWeek,uid:actor,prodKeys:scope.prodKeys})});
      fs.writeFileSync(path.join(outputDir,`${mode}-transaction.json`),JSON.stringify(result,null,2));
      if(mode==='rehearse'){
        await tx.rollback();rolled=true;
        const after=await readState(query),rollbackVerified=stockRepairDigest(after)===expectedHash
          &&(!orderingFixApproved||stockRepairDigest(await readStockCalculationMetadata(query))===stockRepairDigest(originalMetadata));
        if(!rollbackVerified)throw Error('Rollback readback differs; do not apply');
        fs.writeFileSync(rehearsalPath,JSON.stringify({sourceHash:expectedHash,scopeHash:stockRepairDigest(scope),orderingFixApproved,ordering:result.ordering,rollbackVerified,at:new Date().toISOString()}));
        console.log(JSON.stringify({mode,rollbackVerified,ordering:result.ordering,...result.verification}));
      }else{
        committing=true;await tx.commit();began=false;
        const after=await readState(query),readbackHash=stockRepairDigest(after);
        if(readbackHash!==result.afterHash)throw Error('Post-commit state changed; inspect private transaction evidence, do not repeat');
        fs.writeFileSync(path.join(outputDir,'after.json'),JSON.stringify(after));
        if(orderingFixApproved){
          const afterMetadata=await readStockCalculationMetadata(query);
          if(stockRepairDigest({...afterMetadata,definition:null})!==stockRepairDigest({...originalMetadata,definition:null}))throw Error('Post-commit procedure metadata differs; do not repeat');
        }
        console.log(JSON.stringify({mode,committed:true,readbackVerified:true,ordering:result.ordering,...result.verification}));
      }
    }catch(error){
      if(began&&!rolled&&!committing)try{await tx.rollback();rolled=true}catch{}
      console.error(JSON.stringify({mode,error:error.message,rollbackConfirmed:rolled,outcomeUnknown:committing}));process.exitCode=1;
    }
  }
}finally{await pool.close()}
