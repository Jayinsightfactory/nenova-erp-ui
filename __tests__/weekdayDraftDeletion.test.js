const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../lib/weekdayDraftDeletion.js');
const storageHelpers = import('../lib/weekdayDraftStorage.js');
const scope = '533|2026|41';
const plan = { id:'a', draftScope:scope, custKey:533, prodKey:77, year:2026, orderWeek:'41-01', date:'2026-10-11', unit:'송이', quantity:20 };
const split = { scopeKey:scope,custKey:533,prodKey:77,year:2026,majorWeek:'41',orderWeek:'41-01',date:'2026-10-11',unit:'송이',wilsonQuantity:5,expectedTotal:20,expectedRevision:0 };
test('delete exact input and linked Wilson, preserve other scopes and unsaved edits', async () => {
  const { prepareWeekdayDraftDeletion: remove } = await helpers;
  const other = {...plan, id:'b', draftScope:'533|2025|41',year:2025,date:'2025-10-12'};
  const unsaved = {...plan,id:'c',prodKey:78,quantity:90};
  const result = remove({userId:'staff',scope,current:{plans:[plan,other,unsaved],wilsonDrafts:[split]},
    storedScope:{plans:[{...plan,quantity:10}],wilsonDrafts:[{...split,expectedTotal:10}]},expectedDrafts:[plan]});
  assert.deepEqual(result.current.plans,[other,unsaved]);
  assert.deepEqual(result.current.wilsonDrafts,[]);
  assert.deepEqual(result.storedScope,{plans:[],wilsonDrafts:[]});
});
test('stale event/cell and mismatched units or scope fail closed', async () => {
  const h=await helpers;
  const args={userId:'staff',scope,current:{plans:[plan],wilsonDrafts:[]},storedScope:{plans:[],wilsonDrafts:[]}};
  assert.throws(()=>h.prepareWeekdayDraftDeletion({...args,expectedDrafts:[{...plan,quantity:10}]}));
  assert.throws(()=>h.prepareWeekdayDraftDeletion({...args,expectedDrafts:[{...plan,draftScope:'534|2026|41'}]}));
  assert.throws(()=>h.weekdayCellDrafts([plan],scope,{...plan,unit:'박스',expectedDrafts:[plan]}));
  assert.throws(()=>h.weekdayCellDrafts([plan],scope,{...plan,expectedDrafts:[]}));
  assert.deepEqual(h.weekdayCellDrafts([plan],scope,{...plan,expectedDrafts:[plan]}),[plan]);
  assert.throws(()=>h.prepareWeekdayDraftDeletion({...args,expectedDrafts:[],all:true}));
});
test('saved deletion CAS rejects stale tab and publication failure keeps bytes', async () => {
  const h=await storageHelpers, d=await helpers;
  const records=new Map();const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
  h.saveWeekdayScopedInputs(storage,'staff',scope,[plan],[]);
  const baseline={plans:[plan],wilsonDrafts:[]};
  const next=d.prepareWeekdayDraftDeletion({userId:'staff',scope,current:baseline,storedScope:baseline,expectedDrafts:[plan]});
  h.saveWeekdayScopedInputs(storage,'staff',scope,[{...plan,quantity:120}],[],baseline);
  const bytes=storage.getItem(h.weekdayInputStorageKey('staff'));
  assert.throws(()=>h.saveWeekdayScopedInputs(storage,'staff',scope,next.storedScope.plans,[],baseline));
  assert.equal(storage.getItem(h.weekdayInputStorageKey('staff')),bytes);
  assert.deepEqual(baseline.plans,[plan]);
});

test('invalid unsaved upload can be deleted by exact original identity', async () => {
 const h=await helpers; const bad={...plan,unit:'확인 필요',date:'',quantity:''};
 const result=h.prepareWeekdayDraftDeletion({userId:'staff',scope,current:{plans:[bad],wilsonDrafts:[]},storedScope:{plans:[],wilsonDrafts:[]},expectedDrafts:[bad]});
 assert.deepEqual(result.current.plans,[]);
});
test('deleting moved draft clears older saved location and linked saved Wilson', async () => {
 const h=await helpers, moved={...plan,date:'2026-10-12',orderWeek:'41-02'};
 const result=h.prepareWeekdayDraftDeletion({userId:'staff',scope,current:{plans:[moved],wilsonDrafts:[split]},
   storedScope:{plans:[plan],wilsonDrafts:[split]},expectedDrafts:[moved]});
 assert.deepEqual(result.current.plans,[]);
 assert.deepEqual(result.current.wilsonDrafts,[]);
 assert.deepEqual(result.storedScope,{plans:[],wilsonDrafts:[]});
});
test('all deletes saved scope orphans while preserving other scope memory', async () => {
 const h=await helpers;
 const other={...plan,id:'other',draftScope:'533|2025|41',year:2025,date:'2025-10-12'};
 const result=h.prepareWeekdayDraftDeletion({userId:'staff',scope,current:{plans:[other],wilsonDrafts:[split,{...split,scopeKey:'533|2025|41'}]},
   storedScope:{plans:[plan],wilsonDrafts:[split]},expectedDrafts:[],all:true});
 assert.deepEqual(result.current.plans,[other]);
 assert.deepEqual(result.current.wilsonDrafts,[{...split,scopeKey:'533|2025|41'}]);
 assert.deepEqual(result.storedScope,{plans:[],wilsonDrafts:[]});
});
test('publication failure preserves saved bytes and caller memory', async () => {
 const h=await storageHelpers,d=await helpers;
 const records=new Map(); const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};
 h.saveWeekdayScopedInputs(storage,'staff',scope,[plan],[]);
 const current={plans:[plan],wilsonDrafts:[]}, before=JSON.stringify(current);
 const bytes=storage.getItem(h.weekdayInputStorageKey('staff'));
 const next=d.prepareWeekdayDraftDeletion({userId:'staff',scope,current,storedScope:current,expectedDrafts:[plan]});
 storage.setItem=()=>{throw new Error('quota');};
 assert.throws(()=>h.saveWeekdayScopedInputs(storage,'staff',scope,next.storedScope.plans,[],current),/quota/);
 assert.equal(storage.getItem(h.weekdayInputStorageKey('staff')),bytes);
 assert.equal(JSON.stringify(current),before);
});

test('actual horizontal blank-cell payload resolves the trusted selected customer', async () => {
 const d=await helpers; const {horizontalEditPayload}=await import('../lib/weekdayHorizontalMatrix.js');
 const cell=horizontalEditPayload({prodKey:plan.prodKey,name:plan.prodName},{cycle:{year:plan.year}},{unit:plan.unit,date:plan.date,effectiveOrderWeek:plan.orderWeek},'0');
 assert.equal(cell.custKey,undefined,'matrix quantity editing intentionally leaves customer authority to workspace');
 const payload={...cell,quantity:null,clear:true,expectedDrafts:[plan],custKey:plan.custKey};
 assert.deepEqual(d.weekdayCellDrafts([plan],scope,payload),[plan]);
 assert.throws(()=>d.weekdayCellDrafts([plan],scope,{...payload,custKey:999}),'different selected customer never removes the original draft');
});
