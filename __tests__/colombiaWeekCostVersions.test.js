import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preserveColombiaWeekCostVersion as save,readColombiaWeekCostVersion as read} from '../lib/colombiaWeekCostVersions.js';
const scope={country:'CO',orderYear:'2026',orderWeek:'46-02'};
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'co-week-version-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,owner:'TEST_ONLY',scope,versionHash:'a'.repeat(64),snapshot:{rows:[{id:1,quantity:100}],input:{gw:100}},createWorkbook:async()=>Buffer.from('TEST_ONLY synthetic XLSX bytes')};}
test('repeated download returns original bytes/time/snapshot without regeneration; late hydrangea preserves both versions',async t=>{
 const options=await setup(t),first=await save(options);let called=false;
 const repeat=await save({...options,createWorkbook:async()=>{called=true;throw Error('must not regenerate');}});
 assert.equal(called,false);assert.equal(repeat.reused,true);assert.deepEqual(first.bytes,repeat.bytes);assert.deepEqual(first.metadata,repeat.metadata);
 const late=await save({...options,versionHash:'b'.repeat(64),snapshot:{...options.snapshot,rows:[...options.snapshot.rows,{id:2,quantity:50}]},createWorkbook:async()=>Buffer.from('TEST_ONLY late hydrangea')});
 assert.notEqual(late.metadata.sha256,first.metadata.sha256);assert.deepEqual((await read(options)).bytes,first.bytes);
});
test('owner/year/week isolation and conflicting same-version snapshot fail closed',async t=>{
 const o=await setup(t);await save(o);
 assert.equal(await read({...o,owner:'OTHER_TEST_OWNER'}),null);
 assert.equal(await read({...o,scope:{...scope,orderYear:'2025'}}),null);
 assert.equal(await read({...o,scope:{...scope,orderWeek:'47-02'}}),null);
 await assert.rejects(save({...o,snapshot:{rows:[]}}),/다른 근거/);
 await assert.rejects(read({...o,versionHash:'../escape'}),/버전/);
 await assert.rejects(read({...o,scope:{...scope,country:'NL'}}),/버전/);
});
test('concurrent generation admits one creator; failure leaves no published version and can be retried explicitly',async t=>{
 const o=await setup(t);let release,started;const wait=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const pending=save({...o,createWorkbook:async()=>{started();await wait;return Buffer.from('TEST_ONLY concurrent');}});await ready;
 await assert.rejects(save(o),/생성 중/);release();await pending;
 const failed={...o,versionHash:'c'.repeat(64),createWorkbook:async()=>{throw Error('fixture failure');}};
 await assert.rejects(save(failed),/fixture failure/);assert.equal(await read(failed),null);
 assert.equal((await save({...failed,createWorkbook:o.createWorkbook})).reused,false);
});
test('tampered archived bytes are never returned',async t=>{
 const o=await setup(t);await save(o);const [dir]=await fs.readdir(o.root);const file=path.join(o.root,dir,`${o.versionHash}.json`),envelope=JSON.parse(await fs.readFile(file,'utf8'));
 envelope.xlsx=Buffer.from('tampered').toString('base64');await fs.writeFile(file,JSON.stringify(envelope));
 await assert.rejects(read(o),/무결성/);
});
