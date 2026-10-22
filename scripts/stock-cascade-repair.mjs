// Manual operator tool. SELECT-only by default. Private evidence is never committed.
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { createHash } from 'node:crypto';
import { planStockCascadeRepair, verifyStockCascadeRepair, stockRepairDigest } from '../lib/stockCascadeRepair.mjs';
import { recalculateStockCascade } from '../lib/stockCascade.js';

const file=process.argv.find(a=>a.startsWith('--request='))?.slice(10);
if(!file)throw Error('Private --request required');
const {scope,expectedHash,actor:requestActor}=JSON.parse(fs.readFileSync(file,'utf8'));
const actor=requestActor || process.env.NENOVA_REPAIR_ACTOR;
if(!Array.isArray(scope?.prodKeys)||!scope.prodKeys.length||scope.prodKeys.length>20
  ||scope.prodKeys.some(k=>!Number.isInteger(k)||k<=0||k>2147483647))throw Error('Explicit product scope required');
const keys=scope.prodKeys.join(',');
const mode=process.argv.includes('--apply')?'apply':process.argv.includes('--rehearse')?'rehearse':'preview';
const dir=path.resolve('.verify/stock-cascade-repair');fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2));
const protectedQueries={
  stockMasters:'SELECT * FROM StockMaster ORDER BY StockKey',
  products:`SELECT * FROM Product WHERE ProdKey IN (${keys}) ORDER BY ProdKey`,
  otherStock:`SELECT StockKey,ProdKey,Stock FROM ProductStock WHERE ProdKey NOT IN (${keys}) OR ProdKey IS NULL ORDER BY StockKey,ProdKey`,
  allHistory:'SELECT * FROM StockHistory ORDER BY StockHistoryKey',
  orders:'SELECT * FROM OrderDetail ORDER BY OrderDetailKey',
  orderMasters:'SELECT * FROM OrderMaster ORDER BY OrderMasterKey',
  shipments:'SELECT * FROM ShipmentDetail ORDER BY SdetailKey',
  shipmentMasters:'SELECT * FROM ShipmentMaster ORDER BY ShipmentKey',
  shipmentDates:'SELECT * FROM ShipmentDate ORDER BY SdateKey',
  shipmentHistory:`SELECT sh.* FROM ShipmentHistory sh JOIN ShipmentDetail sd ON sd.SdetailKey=sh.SdetailKey
    WHERE sd.ProdKey IN (${keys}) ORDER BY sh.SdetailKey,(SELECT sh.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)`,
  shipmentFarms:'SELECT * FROM ShipmentFarm ORDER BY SdetailKey,FarmKey,ShipmentQuantity',
  warehouse:`SELECT wm.WarehouseKey AS HeaderKey,wm.OrderYear,wm.OrderWeek,wm.isDeleted,wd.*
    FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
    WHERE wd.ProdKey IN (${keys}) ORDER BY wd.WdetailKey`,
  estimates:'SELECT * FROM Estimate ORDER BY EstimateKey',
  report:'SELECT * FROM WebProfitReport ORDER BY OrderYear,MajorWeek,Category,ColKey',
  viewOrder:`SELECT * FROM ViewOrder WHERE ProdKey IN (${keys}) ORDER BY OrderDetailKey`,
  viewShipment:`SELECT * FROM ViewShipment WHERE ProdKey IN (${keys}) ORDER BY SdetailKey`,
};
async function readState(query){
  const get=async text=>(await query(text)).recordset;
  const masters=await get('SELECT StockKey,OrderYear,OrderWeek,OrderYearWeek FROM StockMaster ORDER BY OrderYearWeek,OrderWeek,StockKey');
  const stocks=await get(`SELECT StockKey,ProdKey,Stock FROM ProductStock WHERE ProdKey IN (${keys}) ORDER BY StockKey,ProdKey`);
  const products=await get(`SELECT ProdKey,OutUnit,isDeleted,Stock FROM Product WHERE ProdKey IN (${keys}) ORDER BY ProdKey`);
  const incoming=await get(`SELECT OrderYear,OrderWeek,ProdKey,OutQuantity FROM ViewWarehouse WHERE ProdKey IN (${keys}) ORDER BY OrderYear,OrderWeek,ProdKey,OutQuantity`);
  const outgoing=await get(`SELECT OrderYear,OrderWeek,ProdKey,OutQuantity FROM ViewShipment WHERE ProdKey IN (${keys}) AND DetailFix=1 ORDER BY OrderYear,OrderWeek,ProdKey,OutQuantity`);
  const adjustments=await get(`SELECT sh.StockHistoryKey,sh.OrderYear,sh.OrderWeek,sh.ProdKey,sh.BeforeValue,sh.AfterValue,sh.ChangeType,
    (SELECT COUNT(*) FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType) TypeMatches
    FROM StockHistory sh WHERE ProdKey IN (${keys}) ORDER BY StockHistoryKey`);
  const definition=(await get("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')) Definition"))[0]?.Definition;
  if(!definition)throw Error('Native definition unavailable');
  const protectedState={};
  for(const [key,text] of Object.entries(protectedQueries)){
    protectedState[key]=(await get(`SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),(${text} FOR JSON PATH,INCLUDE_NULL_VALUES))),2) Digest`))[0].Digest;
  }
  const tables=await get("SELECT name FROM sys.tables WHERE name LIKE N'WebProfitReportConfirm%' ORDER BY name");
  for(const {name} of tables){
    if(!/^WebProfitReportConfirm\w*$/.test(name))throw Error('Unexpected snapshot table');
    protectedState[name]=(await get(`SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),
      (SELECT (SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) AS row FROM [${name}] t
       ORDER BY (SELECT t.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) FOR JSON PATH))),2) Digest`))[0].Digest;
  }
  return {masters,stocks,products,incoming,outgoing,adjustments,protected:protectedState,
    procedureHash:createHash('sha256').update(definition).digest('hex')};
}
const pool=await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:300000}).connect();
const query=async(text,params={},tx)=>{const request=tx?new sql.Request(tx):pool.request();
  for(const [name,{type,value}] of Object.entries(params))request.input(name,type,value);return request.query(text);};
try{
  if(mode==='preview'){
    const before=await readState(query),again=await readState(query);
    if(stockRepairDigest(before)!==stockRepairDigest(again))throw Error('Source changed during preview');
    save('before.json',before);
    const plan=planStockCascadeRepair(before,scope);save('plan.json',plan);
    console.log(JSON.stringify({mode,sourceHash:plan.sourceHash,checked:plan.expected.length,
      changed:plan.expected.filter(r=>r.before!==r.after).length,years:[...new Set(plan.expected.map(r=>r.OrderYear))],businessWrites:0}));
  }else{
    if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||!actor)throw Error('Approved hash/operator required');
    if(mode==='apply'){
      const rehearsal=JSON.parse(fs.readFileSync(path.join(dir,'rehearsal.json'),'utf8'));
      if(rehearsal.sourceHash!==expectedHash||rehearsal.scopeHash!==stockRepairDigest(scope)||!rehearsal.rollbackVerified)throw Error('Matching rollback rehearsal required');
    }
    const tx=new sql.Transaction(pool);let began=false,rolled=false,committing=false;
    tx.on('rollback',()=>{rolled=true;});
    try{
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);began=true;
      const tq=(text,params)=>query(text,params,tx);
      await tq('SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;');
      const operator=await tq('SELECT UserID FROM UserInfo WHERE UserID=@uid',{uid:{type:sql.NVarChar,value:actor}});
      if(operator.recordset.length!==1)throw Error('Valid operator required');
      const gate=await tq("SELECT * FROM NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'");
      const row=gate.recordset[0];
      if(gate.recordset.length!==1||row.ProtocolVersion!==2||row.PendingCalc
        ||['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].some(k=>row[k]!==null))throw Error('Stock gate busy');
      const before=await readState(tq);
      if(stockRepairDigest(before)!==expectedHash)throw Error('Source changed; preview again');
      const plan=planStockCascadeRepair(before,scope);
      if(!plan.expected.some(r=>r.before!==r.after))throw Error('Nothing to repair; do not repeat');
      save(`${mode}-backup-${Date.now()}.json`,before);
      await recalculateStockCascade(tq,sql,{orderYear:scope.year,orderWeek:scope.startWeek,uid:actor,prodKeys:scope.prodKeys});
      const after=await readState(tq),verification=verifyStockCascadeRepair(before,after,plan);
      save(`${mode}-transaction.json`,{plan,verification,afterHash:stockRepairDigest(after)});
      if(mode==='rehearse'){
        await tx.rollback();rolled=true;
        const rollbackVerified=stockRepairDigest(await readState(query))===expectedHash;
        if(!rollbackVerified)throw Error('Rollback readback differs; do not apply');
        save('rehearsal.json',{sourceHash:expectedHash,scopeHash:stockRepairDigest(scope),rollbackVerified,at:new Date().toISOString()});
        console.log(JSON.stringify({mode,rollbackVerified,...verification}));
      }else{
        committing=true;await tx.commit();began=false;
        const readback=await readState(query);save('after.json',readback);
        if(stockRepairDigest(readback)!==stockRepairDigest(after))throw Error('Post-commit state differs; inspect, do not repeat');
        console.log(JSON.stringify({mode,committed:true,readbackVerified:true,...verification}));
      }
    }catch(error){
      if(began&&!rolled&&!committing)try{await tx.rollback();rolled=true;}catch{}
      console.error(JSON.stringify({mode,error:error.message,rollbackConfirmed:rolled,outcomeUnknown:committing}));process.exitCode=1;
    }
  }
}finally{await pool.close();}
