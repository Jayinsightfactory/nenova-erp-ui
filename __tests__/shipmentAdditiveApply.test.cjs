const test=require('node:test'),assert=require('node:assert/strict');
const {createImportLoader}=require('./helpers/shipmentImportLoader.cjs');
// Executes the real save entry/core, with an explicit read-only SQL fixture.
// No operational connection; any mutation is a test failure.
function fixture({alreadyChanged=false,race=false}={}){
 let inTx=false,transactions=0,mutations=0,failed=0;
 const product={OutUnit:'박스',EstUnit:'박스',ProdName:'fixture',CountryFlower:'fixture',BunchOf1Box:10,SteamOf1Box:100,Cost:100};
 const q=async(sql,params)=>{
  if(/\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(sql)){mutations++;throw Error('Unexpected mutation');}
  if(/COL_LENGTH/.test(sql))return{recordset:[{HasColumn:1}]};
  if(/FROM Product/.test(sql))return{recordset:[product]};
  if(/FROM Customer/.test(sql))return{recordset:[{OrderCode:'FIXTURE',BaseOutDay:0}]};
  if(/SELECT TOP 1 od.OrderDetailKey/.test(sql))return{recordset:[{OrderDetailKey:1,OutQuantity:10,BoxQuantity:10}]};
  if(/AS currentOutQty/.test(sql))return{recordset:[{currentOutQty:alreadyChanged||(race&&inTx)?13:10,dateIssueCount:0}]};
  if(/FROM ShipmentMaster/.test(sql))return{recordset:[]};
  throw Error('Unimplemented read: '+sql.slice(0,160));
 };
 const load=createImportLoader({db:{query:q,sql:{Int:'Int',NVarChar:'NVarChar',Float:'Float'},withTransaction:async work=>{transactions++;inTx=true;try{return await work(q);}finally{inTx=false;}}},mocks:{
  importApplyLease:{withImportApplyLease:work=>work()},
  shipmentImportAudit:{createShipmentImportAuditBatch:async()=>1,failShipmentImportAuditBatch:async()=>failed++},
  shipmentImportSnapshot:{assertShipmentImportSnapshotSchema:async()=>{}},
 }});
 return{apply:()=>load('shipmentImport').applyImportRows({rawYear:'2026',rawWeek:'46-01',distributionMode:'ADD',rows:[{custKey:1,prodKey:2,currentOutQty:10,orderQty:10,excelQty:3,inputQty:3,uploadQty:13,distributionMode:'ADD',outUnit:'박스',excelUnit:'박스'}],user:{userId:'fixture'}}),stats:()=>({transactions,mutations,failed})};
}
test('real save preflight rejects a different job whose current quantity already equals target13',async()=>{
 const f=fixture({alreadyChanged:true});await assert.rejects(f.apply(),e=>e.code==='IMPORT_MODE_REVERIFY');assert.deepEqual(f.stats(),{transactions:0,mutations:0,failed:1});
});
test('real save rechecks locked baseline after preflight: racing job cannot silently lose its increment',async()=>{
 const f=fixture({race:true});await assert.rejects(f.apply(),e=>e.code==='IMPORT_MODE_REVERIFY');assert.deepEqual(f.stats(),{transactions:1,mutations:0,failed:1});
});
