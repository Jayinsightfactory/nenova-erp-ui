const {test} = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../lib/weekdayWorkbookExportPlan.js');
const link = {sheet:'수국',sourceCell:'D8',date:'2026-10-11',year:2026,orderWeek:'41-01',prodKey:77,custKey:533,unit:'송이',draftScope:'533|2026|41',fileId:'file-a'};
const actual = {year:2026,orderWeek:'41-01',prodKey:77,custKey:533,outUnit:'STEM',state:'FOUND_UNFIXED',detailRows:1,shipmentDates:[{date:'2026-10-11',shipmentQuantity:8}]};
const args = extra => ({links:[link],plans:[],compareRows:[actual],custKey:533,scopeKey:link.draftScope,fileId:'file-a',...extra});
test('exports absolute latest quantity, never adds Wilson; isolates files scopes and years',async()=>{
 const {buildWeekdayWorkbookExportUpdates:build}=await modulePromise;
 const plan={...link,quantity:3};
 assert.deepEqual(build(args({plans:[plan],wilsonDrafts:[{wilsonQuantity:2}]})),[{sheetName:'수국',address:'D8',value:3}]);
 assert.equal(build(args({compareRows:[{...actual,year:2025,shipmentDates:[{date:'2025-10-11',shipmentQuantity:900}]},actual]}))[0].value,8);
 assert.deepEqual(build(args({fileId:'other'})),[]);
 assert.deepEqual(build(args({links:[{...link,draftScope:'533|2025|41',year:2025}]})),[]);
});
test('after apply uses actual quantity; explicit known absence is zero; unknown blocks',async()=>{
 const {buildWeekdayWorkbookExportUpdates:build}=await modulePromise;
 assert.equal(build(args())[0].value,8);
 assert.equal(build(args({compareRows:[{...actual,shipmentDates:[]}]}))[0].value,0);
 assert.equal(build(args({compareRows:[{...actual,state:'NO_SHIPMENT',detailRows:0,shipmentOutQuantity:null,shipmentDates:[]}]}))[0].value,0);
 assert.throws(()=>build(args({compareRows:[]})));
 assert.throws(()=>build(args({compareRows:[{...actual,state:'UNKNOWN'}]})));
 assert.throws(()=>build(args({compareRows:[{...actual,shipmentDates:null}]})));
});
test('explicit plans cannot bypass unknown or inconsistent actual snapshots',async()=>{
 const {buildWeekdayWorkbookExportUpdates:build}=await modulePromise;
 const plans=[{...link,quantity:3}];
 for(const row of [{...actual,state:'UNKNOWN'}, {...actual,customerLinkError:'wrong owner'},
   {...actual,state:'NO_SHIPMENT',detailRows:0,shipmentDates:[]},
   {...actual,state:'NO_SHIPMENT',detailRows:0,shipmentOutQuantity:0,shipmentDates:[]},
   {...actual,state:'NO_SHIPMENT',detailRows:0,shipmentOutQuantity:null}]) {
   assert.throws(()=>build(args({plans,compareRows:[row]})));
 }
 assert.equal(build(args({plans,compareRows:[{...actual,state:'NO_SHIPMENT',detailRows:0,shipmentOutQuantity:null,shipmentDates:[]}]}))[0].value,3);
});
test('moved linked cell, duplicate identities, mismatched units and blank quantities fail closed',async()=>{
 const {buildWeekdayWorkbookExportUpdates:build}=await modulePromise;
 assert.throws(()=>build(args({plans:[{...link,date:'2026-10-12',quantity:3}]})),/다시 연결/);
 assert.throws(()=>build(args({links:[link,{...link,sourceCell:'E8'}]})),/복수 원본/);
 assert.throws(()=>build(args({plans:[{...link,quantity:3},{...link,quantity:4}]})),/복수 입력/);
 assert.throws(()=>build(args({compareRows:[actual,actual]})));
 assert.throws(()=>build(args({compareRows:[{...actual,outUnit:'박스'}]})));
 for(const quantity of ['',null,-1,Infinity,NaN]) assert.throws(()=>build(args({plans:[{...link,quantity}]})));
 assert.throws(()=>build(args({plans:[{...link,unit:'박스',quantity:3}]})));
});
test('unmapped original cells stay untouched and malformed or duplicate actual dates block',async()=>{
 const {buildWeekdayWorkbookExportUpdates:build}=await modulePromise;
 assert.equal(build(args()).length,1);
 assert.throws(()=>build(args({links:[{...link,sourceCell:'D0'}]})));
 assert.throws(()=>build(args({compareRows:[{...actual,shipmentDates:[{date:'2026-02-30',shipmentQuantity:8}]}]})));
 assert.throws(()=>build(args({compareRows:[{...actual,shipmentDates:[actual.shipmentDates[0],actual.shipmentDates[0]]}]})));
});
