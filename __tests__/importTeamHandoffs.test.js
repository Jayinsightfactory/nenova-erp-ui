import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {HANDOFF_KEY,emptyHandoff,validateImportHandoffs,handoffChanges,handoffActor} from '../lib/importTeamHandoffs.js';
import {writeImportTeamRecord,readImportTeamRecord} from '../lib/importTeamStore.js';
const row=()=>({...emptyHandoff(),id:randomUUID(),title:'항공 지연',issue:'지연 발생',action:'포워더 연락',caution:'입고 확정 전 공유',checks:'대체 항공 확인'});
test('handoff rejects spoofed accounts, invalid states and unsafe multi-row edits',()=>{
 const item=row();assert.deepEqual(validateImportHandoffs([item]),[item]);
 for(const value of [null,{},[{...item,userId:'admin'}],[item,item],[{...item,status:'__proto__'}],[{...item,title:''}],[{...item,issue:'x'.repeat(2001)}]])assert.throws(()=>validateImportHandoffs(value));
 assert.throws(()=>handoffChanges([],[item,row()]));assert.equal(handoffChanges([item],[item]).length,0);
 const second=row();assert.throws(()=>handoffChanges([item,second],[second,item]));
});
test('handoff CRUD records server account and exact before/after, conflicts preserve data',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-test-'));
 try{
  const actor={userId:'a',userName:'등록자'},other={userId:'b',userName:'처리자'},item=row();
  let saved=await writeImportTeamRecord(HANDOFF_KEY,{value:[item],expectedRevision:0,actor},{root});
  assert.equal(saved.history[0].userId,'a');assert.deepEqual(saved.history[0].changes[0].after,item);
  const updated={...item,status:'DONE',action:'대체 항공 확정'};
  saved=await writeImportTeamRecord(HANDOFF_KEY,{value:[updated],expectedRevision:1,actor:other},{root});
  assert.deepEqual(saved.history[1].changes[0],{id:item.id,before:item,after:updated});assert.equal(handoffActor(saved.history,item.id).userId,'b');
  await assert.rejects(writeImportTeamRecord(HANDOFF_KEY,{value:[],expectedRevision:1,actor},{root}),e=>e.statusCode===409);
  saved=await writeImportTeamRecord(HANDOFF_KEY,{value:[],expectedRevision:2,actor},{root});
  assert.deepEqual(saved.history[2].changes[0].before,updated);assert.equal(saved.history[2].changes[0].after,null);
  assert.deepEqual((await readImportTeamRecord(HANDOFF_KEY,{root})).value,[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('handoff audit rollover archives instead of deleting old account logs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-archive-'));
 try{
  const item=row(),actor={userId:'a',userName:'담당자'};let saved;
  for(let i=0;i<52;i++)saved=await writeImportTeamRecord(HANDOFF_KEY,{value:[{...item,action:`처리 ${i}`}],expectedRevision:i,actor},{root});
  assert.equal(saved.history.length,50);assert.equal(saved.historyArchive.eventCount,2);
  const [folder]=await fs.readdir(path.join(root,'history'));const archived=JSON.parse(await fs.readFile(path.join(root,'history',folder,'000000000001.json'),'utf8'));
  assert.equal(archived.userId,'a');assert.equal(archived.changes[0].after.action,'처리 0');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
