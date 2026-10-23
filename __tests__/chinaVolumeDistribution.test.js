import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./fixtures/dutchVolumeLoaderHook.mjs',import.meta.url);
const { previewChinaVolume } = await import('../pages/api/shipment/china-volume-preview.js');
const { applyChinaVolume } = await import('../pages/api/shipment/china-volume-apply.js');
const { claimDutchPlan } = await import('../lib/dutchVolumeDistribution.js');
const { chinaOrderUnits } = await import('../lib/chinaOrderUnits.js');
const nativeProduct={OutUnit:'단',EstUnit:'송이',BunchOf1Box:30,SteamOf1Bunch:10,SteamOf1Box:300};
assert.deepEqual(chinaOrderUnits(8,nativeProduct),{box:8/30,bunch:8,steam:80,outQty:8,estQty:80});
assert.equal(chinaOrderUnits(0.25,nativeProduct).estQty,2.5,'native order quantity is not rounded like shipment estimate');
assert.equal(chinaOrderUnits(8,{...nativeProduct,SteamOf1Box:0}).estQty,80,'bunch conversion uses SteamOf1Bunch');
assert.equal(chinaOrderUnits(2,{...nativeProduct,OutUnit:'박스',SteamOf1Box:250}).estQty,500,'native box override');
assert.equal(chinaOrderUnits(80,{...nativeProduct,OutUnit:'송이',EstUnit:'단'}).estQty,8);
assert.equal(chinaOrderUnits(0,nativeProduct).estQty,0);
assert.throws(()=>chinaOrderUnits(8,{...nativeProduct,SteamOf1Bunch:0}),/환산/);
assert.throws(()=>chinaOrderUnits(-1,nativeProduct),/수량/);
const user={userId:'china-fixture'};
const body={year:2026,week:'40-01',entries:[{id:'1',custKey:1,prodKey:11,quantity:3,unit:'박스'}]};
const row={key:'1|11',custKey:1,prodKey:11,entryIds:['1'],uploadQty:3,currentOutQty:5,orderQty:10,outUnit:'박스'};
const snapshot={orders:[{OrderDetailKey:1,CustKey:1,ProdKey:11,OutQuantity:10}],shipments:[{MasterCustKey:1,ProdKey:11,SdetailKey:5,OutQuantity:5,Cost:100,ShipmentDtm:'2026-10-01'}],products:[{ProdKey:11,OutUnit:'박스',EstUnit:'박스'}],dates:[{SdetailKey:5,ShipmentQuantity:5,ShipmentDtm:'2026-10-01'}],farms:[],orderMasters:[],shipmentMasters:[]};
const deps={withTransaction:fn=>fn(()=>{}),buildPreview:async args=>{
 assert.equal(args.countryFilter,'중국');assert.equal(String(args.rawYear),'2026');
 return {rows:[row,{...row,key:'2|11',custKey:2,entryIds:[],missingFromExcel:true,uploadQty:0,fixBlocked:true}],replacementCategories:['중국장미'],fixBlockedRows:[{custKey:2,prodKey:11,missingFromExcel:true}],unmatched:[]};
},readSnapshot:async(_q,scope)=>{assert.equal(scope.country,'중국');assert.equal(scope.pairs.length,1);return {snapshot,digest:'fixture'};}};
const plan=await previewChinaVolume(body,user,deps);
assert.equal(plan.rows.length,1);assert.equal(plan.scopeMode,'EXPLICIT_PAIRS');assert.equal(plan.rows[0].orderAfterQty,10);assert.ok(plan.planToken);
assert.throws(()=>claimDutchPlan(plan.planToken,user,'bad-job'),/다른 물량표/);
let called;
await applyChinaVolume({planToken:plan.planToken,jobId:'china_fixture_job_123456'},user,{applyImportRows:async args=>{called=args;return {success:true};}});
assert.equal(called.fullCategoryReplacement,false);assert.equal(called.shipmentOnly,false);assert.equal(called.dutchPlan.existingOrders[0].OutQuantity,10);
assert.equal(called.rows.length,1);assert.equal(called.rows[0].uploadQty,3);
const fixedPlan = await previewChinaVolume(body,user,{...deps,buildPreview:async()=>({
 rows:[{...row,fixBlocked:true,fixBlockReason:'ERP 확정'}],replacementCategories:['중국장미'],
 fixBlockedRows:[{custName:'fixture customer',prodName:'fixture product',reason:'ERP 확정'}],unmatched:[],
})});
assert.equal(fixedPlan.planToken,null);
assert.ok(fixedPlan.blockers.some(message=>message.includes('ERP 확정 출고 1건')));
assert.equal(fixedPlan.fixBlockedRows.length,1);
await assert.rejects(()=>applyChinaVolume({planToken:plan.planToken,jobId:'china_fixture_job_789012'},user),/이미/);
await assert.rejects(()=>previewChinaVolume({...body,year:undefined},user,deps),/연도|year/i);
await assert.rejects(()=>previewChinaVolume({...body,entries:[{...body.entries[0],custKey:null}]},user,deps),/DB/);
await assert.rejects(()=>previewChinaVolume({...body,entries:[{...body.entries[0],unitPrice:1}]},user,deps),/단가/);
console.log('PASS China explicit pair scope, no category omission writes, year required, existing order preservation, single-use owner/country plan');

process.exit(0);
