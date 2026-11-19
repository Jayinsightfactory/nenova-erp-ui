import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCountryOrderHistoryStore,latestCompleteCountryOrderDelivery} from '../lib/countryOrderHistoryStore.js';
test('immutable bytes/snapshot, explicit separate delivery, restart and cross-year isolation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'country-order-history-test-'));
  try{
    let clock='2026-11-19T01:00:00Z';const store=createCountryOrderHistoryStore({root,now:()=>new Date(clock)});
    const scope={country:'China',year:2026,orderWeek:'47-02'},id=randomUUID();
    const input={scope,id,filename:'test-only.xlsx',bytes:Buffer.from([0x50,0x4b,3,4,1,2]),rows:[{quantity:120}],sourceKeys:['m1/r1'],queriedAt:'2026-11-19T00:55:00Z',actor:'fixture-user'};
    const one=await store.save(input);assert.equal(one.deliveredAt,null);
    clock='2026-11-19T02:00:00Z';assert.equal((await store.save(input)).downloadedAt,one.downloadedAt);
    await assert.rejects(store.save({...input,rows:[{quantity:140}]}),{code:'HISTORY_ID_CONFLICT'});
    await assert.rejects(store.markDelivered({scope,id,sha256:one.sha256,actor:'fixture-user',confirmed:false}),{code:'CONFIRM_REQUIRED'});
    const sent=await store.markDelivered({scope,id,sha256:one.sha256,actor:'fixture-user',confirmed:true});
    clock='2026-11-19T03:00:00Z';assert.equal((await store.markDelivered({scope,id,sha256:one.sha256,actor:'fixture-user',confirmed:true})).deliveredAt,sent.deliveredAt);
    const again=createCountryOrderHistoryStore({root});const opened=await again.read(scope,id);assert.deepEqual(opened.bytes,input.bytes);assert.equal(opened.sha256,one.sha256);assert.equal((await again.latestDelivered(scope)).id,id);
    assert.deepEqual(await again.list({...scope,year:2025}),[]);assert.deepEqual(await again.list({...scope,country:'Colombia'}),[]);
    await assert.rejects(again.read(scope,'../../bad'),{code:'INVALID_HISTORY_ID'});
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
test('a split farm/unit batch becomes a baseline only after every original is explicitly delivered',()=>{
  const scope={country:'China',year:2026,orderWeek:'47-02'},batchId=randomUUID(),expectedFiles=['farm-a.xlsx','farm-b.xlsx'];
  const first={id:randomUUID(),scope,batchId,expectedFiles,filename:expectedFiles[0],rows:[{quantity:120}],sourceKeys:['m1'],deliveredAt:'2026-11-19T01:00:00Z'};
  const second={...first,id:randomUUID(),filename:expectedFiles[1],deliveredAt:null};
  assert.equal(latestCompleteCountryOrderDelivery([first]),null);assert.equal(latestCompleteCountryOrderDelivery([first,second]),null);
  second.deliveredAt='2026-11-19T02:00:00Z';assert.equal(latestCompleteCountryOrderDelivery([first,second]).deliveredAt,second.deliveredAt);
  assert.equal(latestCompleteCountryOrderDelivery([first,{...second,rows:[{quantity:140}]}]),null);
});
