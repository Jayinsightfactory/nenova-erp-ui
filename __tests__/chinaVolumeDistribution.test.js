import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./fixtures/dutchVolumeLoaderHook.mjs',import.meta.url);
const { previewChinaVolume } = await import('../pages/api/shipment/china-volume-preview.js');
const { applyChinaVolume } = await import('../pages/api/shipment/china-volume-apply.js');
const { claimDutchPlan } = await import('../lib/dutchVolumeDistribution.js');
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
await assert.rejects(()=>applyChinaVolume({planToken:plan.planToken,jobId:'china_fixture_job_789012'},user),/이미/);
await assert.rejects(()=>previewChinaVolume({...body,year:undefined},user,deps),/연도|year/i);
await assert.rejects(()=>previewChinaVolume({...body,entries:[{...body.entries[0],custKey:null}]},user,deps),/DB/);
await assert.rejects(()=>previewChinaVolume({...body,entries:[{...body.entries[0],unitPrice:1}]},user,deps),/단가/);
console.log('PASS China explicit pair scope, no category omission writes, year required, existing order preservation, single-use owner/country plan');

process.exit(0);
