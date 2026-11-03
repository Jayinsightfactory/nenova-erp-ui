import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {operationCapabilities,previewOperation,confirmOperation,getOperation,listOperations} from '../lib/operationLedger.js';

test('personal operations require confirmation, persist, verify and isolate accounts',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-operations-'));
  const options={root:path.join(temp,'operations'),personalRoot:path.join(temp,'personal'),now:()=>new Date('2026-11-03T08:00:00Z')};
  const user={userId:'owner-a',userName:'담당자',accountActive:true},other={userId:'owner-b',accountActive:true};
  try{
    assert.equal(operationCapabilities(user).length,5);
    const preview=await previewOperation(user,{toolId:'personal-home.create',origin:'ai',input:{date:'2026-11-03',title:'발주 확인'}},options);
    assert.equal(preview.state,'awaiting_confirmation');
    assert.equal(preview.confirmationRequired,true);
    await assert.rejects(()=>confirmOperation(user,preview.operationId,{confirmed:false,expectedRevision:0},options),e=>e.code==='CONFIRMATION_REQUIRED');
    await assert.rejects(()=>getOperation(other,preview.operationId,options),e=>e.code==='NOT_FOUND');
    const done=await confirmOperation(user,preview.operationId,{confirmed:true,expectedRevision:0},options);
    assert.equal(done.state,'verified');assert.equal(done.verification.matched,true);assert.equal(done.result.count,1);
    assert.deepEqual(await confirmOperation(user,preview.operationId,{confirmed:true,expectedRevision:0},options),done);
    const lookup=await previewOperation(user,{toolId:'personal-home.list',input:{date:'2026-11-03'}},options);
    assert.equal(lookup.state,'verified');assert.equal(lookup.result.tasks.length,1);assert.equal(lookup.result.tasks[0].title,'발주 확인');
    const archived=await previewOperation(user,{toolId:'personal-home.archive',input:{date:'2026-11-03',taskId:done.result.taskId}},options);
    assert.equal((await confirmOperation(user,archived.operationId,{confirmed:true,expectedRevision:1},options)).state,'verified');
    const restored=await previewOperation(user,{toolId:'personal-home.restore',input:{date:'2026-11-03',taskId:done.result.taskId}},options);
    assert.equal((await confirmOperation(user,restored.operationId,{confirmed:true,expectedRevision:2},options)).state,'verified');
    const changed=await previewOperation(user,{toolId:'personal-home.update',input:{date:'2026-11-03',taskId:done.result.taskId,title:'견적 확인'}},options);
    assert.equal((await confirmOperation(user,changed.operationId,{confirmed:true,expectedRevision:3},options)).state,'verified');
    const stale=await previewOperation(user,{toolId:'personal-home.create',input:{date:'2026-11-03',title:'이전 버전'}},options);
    const fresh=await previewOperation(user,{toolId:'personal-home.create',input:{date:'2026-11-03',title:'새 버전'}},options);
    assert.equal((await confirmOperation(user,fresh.operationId,{confirmed:true,expectedRevision:4},options)).state,'verified');
    assert.equal((await confirmOperation(user,stale.operationId,{confirmed:true,expectedRevision:4},options)).state,'failed');
    const list=await listOperations(user,{},options);assert.equal(list.total,7);assert.ok(list.items.some(item=>item.operationId===archived.operationId));
    assert.equal((await listOperations(other,{},options)).total,0);
    const previousYear=await previewOperation(other,{toolId:'personal-home.create',input:{date:'2025-11-03',title:'전년도 기록'}},options);
    assert.equal((await confirmOperation(other,previousYear.operationId,{confirmed:true,expectedRevision:0},options)).state,'verified');
    const currentYear=await previewOperation(other,{toolId:'personal-home.list',input:{date:'2026-11-03'}},options);
    assert.equal(currentYear.result.count,1);assert.equal(currentYear.result.tasks[0].date,'2025-11-03');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
