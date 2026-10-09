const test=require('node:test');
const assert=require('node:assert/strict');
const {snapshotKey,readInboxSnapshot,writeInboxSnapshot}=require('../lib/distributionInboxSnapshot');

function memoryIndexedDB() {
  const records=new Map();
  let quota=false;
  const database={
    objectStoreNames:{contains:()=>true},close(){},
    transaction(_name,_mode){
      const tx={error:null,objectStore(){return {
        get(key){const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return request;},
        put(record){queueMicrotask(()=>{if(quota){tx.error=new Error('QuotaExceededError');tx.onerror?.();return;}records.set(record.key,structuredClone(record));tx.oncomplete?.();});},
      };},abort(){tx.onabort?.();}};
      return tx;
    },
  };
  return {records,setQuota:value=>{quota=value;},open(){const request={result:database};queueMicrotask(()=>request.onsuccess?.());return request;}};
}

const scope={userId:'user-a',year:'2026',week:'2026-40-01'};
const data={from:'2026-10-01',to:'2026-10-08',loadedPeriod:'2026-10-01/2026-10-08',rows:[{identity:'raw|1',message:'원문 그대로',created_at:'2026-10-02T00:00:00Z'}],cursor:'cursor',more:true,
  liveHistory:{'raw|1':{sourceIdentity:'raw|1',status:'ORDER_AND_DISTRIBUTION',requests:[]}},liveBalanceComparison:{items:[]},liveHistoryStatus:{loaded:true,asOf:'2026-10-08T00:00:00Z',scope:`${snapshotKey(scope.userId,scope.year,scope.week)}:2026:40-01:2026-10-01/2026-10-08`},
  manualApplications:{'raw|1':{status:'MANUALLY_APPLIED'}},auditApplications:{},operationApplications:{},operationHistory:[],applicationStatus:{loaded:true,asOf:'2026-10-08T00:00:00Z'}};

test('exact account, year and full week restore raw identity and evidence without a TTL',async()=>{
  const indexedDB=memoryIndexedDB();
  const savedAt='2026-10-08T01:00:00.000Z';
  await writeInboxSnapshot(scope,data,{indexedDB,now:()=>savedAt});
  assert.deepEqual((await readInboxSnapshot(scope,{indexedDB})).data,data);
  assert.equal((await readInboxSnapshot(scope,{indexedDB})).savedAt,savedAt);
  assert.equal(await readInboxSnapshot({...scope,userId:'user-b'},{indexedDB}),null);
  assert.equal(await readInboxSnapshot({...scope,year:'2025',week:'2025-40-01'},{indexedDB}),null);
  assert.equal(await readInboxSnapshot({...scope,week:'2026-40-02'},{indexedDB}),null);
  assert.equal(snapshotKey('',scope.year,scope.week),'');
  assert.equal(snapshotKey('user-a','2025',scope.week),'');
});

test('older snapshots and quick re-entry preserve the latest successful data',async()=>{
  const indexedDB=memoryIndexedDB();
  const older={...scope,week:'2026-39-01'};
  const first=writeInboxSnapshot(older,data,{indexedDB,now:()=> '2026-09-30T00:00:00Z'});
  assert.deepEqual((await readInboxSnapshot(older,{indexedDB})).data.rows,data.rows);
  await first;
  await writeInboxSnapshot(scope,data,{indexedDB});
  indexedDB.setQuota(true);
  await assert.rejects(writeInboxSnapshot(scope,{...data,rows:[]},{indexedDB}),/QuotaExceededError/);
  assert.deepEqual((await readInboxSnapshot(scope,{indexedDB})).data.rows,data.rows);
  assert.deepEqual((await readInboxSnapshot(older,{indexedDB})).data.rows,data.rows);
});

test('corrupt and unknown-version records are ignored',async()=>{
  const indexedDB=memoryIndexedDB();
  const key=snapshotKey(scope.userId,scope.year,scope.week);
  indexedDB.records.set(key,{key,version:99,savedAt:new Date().toISOString(),data});
  await assert.rejects(readInboxSnapshot(scope,{indexedDB}),/Invalid inbox snapshot record/);
  indexedDB.records.set(key,{key,version:1,savedAt:new Date().toISOString(),data:{...data,rows:[{identity:'x'}]}});
  await assert.rejects(readInboxSnapshot(scope,{indexedDB}),/Invalid inbox snapshot record/);
  await assert.rejects(readInboxSnapshot(scope,{indexedDB:undefined}),/IndexedDB unavailable/);
});


test('same actor/year week transition retains latest raw feed and pending without inheriting evidence',()=>{
  const {retainInboxFeed}=require('../lib/distributionInboxSnapshot');
  const old={identity:'old',message:'saved original',created_at:'2026-10-08T00:00:00Z'};
  const latest={identity:'latest',message:'newly received',created_at:'2026-10-09T00:00:00Z'};
  const pending={identity:'pending',message:'pending while reviewing',created_at:'2026-10-09T01:00:00Z'};
  const owner=JSON.stringify(['user-a','2026']);
  const input={owner,previousOwner:owner,rows:[old,latest],pending:[pending]};
  const saved={rows:[{...old,message:'older snapshot text'}],pendingRows:[latest],liveHistory:{old:{status:'ORDER_AND_DISTRIBUTION'}},manualApplications:{old:{status:'MANUALLY_APPLIED'}}};
  const result=retainInboxFeed(input,saved);
  assert.deepEqual(result.rows,[old,latest]);
  assert.deepEqual(result.pending,[pending]);
  assert.equal(result.liveHistory,undefined);
  assert.equal(result.manualApplications,undefined);
  assert.deepEqual(retainInboxFeed(input).rows,[old,latest],'empty target snapshot preserves incoming feed');
  assert.deepEqual(retainInboxFeed({...input,owner:JSON.stringify(['user-b','2026'])}),{rows:[],pending:[]});
  assert.deepEqual(retainInboxFeed({...input,owner:JSON.stringify(['user-a','2025'])}),{rows:[],pending:[]},'prior-year same week never inherits feed or evidence');
});
