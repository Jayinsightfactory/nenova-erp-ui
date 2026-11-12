import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import settings from '../desktop/shell/task-settings.js';
import {mutatePersonalHome,readPersonalHome,personalHomeTasks} from '../lib/personalHomeStore.js';

test('schedule normalization covers midnight, omitted, empty, invalid and safe links',()=>{
 const prior={startTime:'09:00',endTime:'09:30',shortcut:{kind:'desktop',target:'/orders/new',label:'주문등록'}};
 assert.deepEqual(settings.normalize({},prior),prior);
 assert.deepEqual(settings.normalize({startTime:'',endTime:'',shortcut:null},prior),{startTime:'',endTime:'',shortcut:null});
 assert.equal(settings.normalize({startTime:'00:00',endTime:'00:01'}).startTime,'00:00');
 for(const input of [{startTime:'24:00'},{startTime:false},{startTime:'9:00'},{endTime:'10:00'},{startTime:'09:00',endTime:'09:00'},{startTime:'23:00',endTime:'01:00'}])assert.throws(()=>settings.normalize(input));
 for(const target of ['/api/orders','/login','//evil.test','/orders?save=1','/orders#x','javascript:alert(1)'])assert.throws(()=>settings.normalize({shortcut:{kind:'desktop',target,label:'열기'}}));
 for(const target of ['file:///C:/x','javascript:alert(1)','https://user:pass@example.com','https://example.com\n'])assert.throws(()=>settings.normalize({shortcut:{kind:'web',target,label:'열기'}}));
 for(const target of ['http://example.com','https://example.com/path'])assert.match(settings.normalize({shortcut:{kind:'web',target,label:'웹'}}).shortcut.target,/^https?:/);
});

test('real owner storage persists settings, preserves old dates and supports legacy clients and explicit clearing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-schedule-'));let request=0;
 const now=()=>new Date('2026-01-01T03:00:00Z');
 const save=async(revision,rest)=>mutatePersonalHome('schedule-owner',{action:'update',expectedRevision:revision,requestId:'schedule_'+(++request),date:'2026-01-01',...rest},{root,now});
 try{
  let record=await save(0,{action:'create',title:'매일 확인',startDate:'2025-12-31',frequency:'daily',weekdays:[0,1,2,3,4,5,6],startTime:'09:00',endTime:'09:30',shortcut:{kind:'desktop',target:'/orders/new',label:'주문등록'}});
  const id=record.rules[0].id;
  record=await save(1,{taskId:id,title:'시간 변경',startTime:'10:00',endTime:'10:30'});
  const find=(date)=>personalHomeTasks(record,date).tasks.find(t=>t.occurrenceDate===date);
  assert.equal(find('2025-12-31').startTime,'09:00');assert.equal(find('2026-01-01').startTime,'10:00');assert.equal(find('2026-01-02').startTime,'10:00');assert.equal(find('2026-01-02').shortcut.label,'주문등록');
  record=await save(2,{taskId:id,title:'구형 앱 제목 수정'});assert.equal(find('2026-01-01').startTime,'10:00');assert.equal(find('2026-01-02').shortcut.label,'주문등록');
  record=await save(3,{taskId:id,title:'연결 해제',startTime:'',endTime:'',shortcut:null});assert.equal(find('2026-01-01').startTime,'');assert.equal(find('2026-01-02').shortcut,null);assert.equal(find('2025-12-31').shortcut.label,'주문등록');
  const disk=await readPersonalHome('schedule-owner',{root});assert.deepEqual(disk,record);assert.equal((await readPersonalHome('another-owner',{root})).rules.length,0);
  await assert.rejects(()=>save(4,{taskId:id,title:'오류',startTime:'24:00'}),e=>e.statusCode===400);assert.equal((await readPersonalHome('schedule-owner',{root})).revision,4);
  await assert.rejects(()=>save(3,{taskId:id,title:'stale'}),e=>e.statusCode===409);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
