import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const actorKey=value=>createHash('sha256').update('nenova-company-author\0'+value).digest('hex');
import {companyCalendar} from '../lib/companyCalendarStore.js';
import {mutatePersonalHome} from '../lib/personalHomeStore.js';
const a={userId:'employee-A',accountActive:true},b={userId:'employee-B',accountActive:true},admin={userId:'nenovaSS3',accountActive:true};
const query={month:'2026-11',week:'2026-11-13',date:'2026-11-13'};
const create=(expectedRevision,extra={})=>({action:'create',expectedRevision,requestId:randomUUID(),title:'회사 회의',date:'2026-11-13',startTime:'09:30',endTime:'10:30',note:'공통 안내',...extra});
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-company-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('company event shares across employees; only author/admin edits, no creator identity leaks',()=>fixture(async root=>{
 let result=await companyCalendar(a,query,create(0),{root});const id=result.events[0].id;assert.equal(result.events[0].canEdit,true);
 result=await companyCalendar(b,query,null,{root});assert.equal(result.events[0].title,'회사 회의');assert.equal(result.events[0].canEdit,false);assert.equal('createdBy'in result.events[0],false);
 await assert.rejects(companyCalendar(b,query,{action:'delete',expectedRevision:1,requestId:randomUUID(),id},{root}),e=>e.statusCode===403);
 result=await companyCalendar(a,query,{...create(1,{title:'변경된 회의'}),action:'update',id},{root});assert.equal(result.events[0].title,'변경된 회의');
 result=await companyCalendar(admin,query,{action:'delete',expectedRevision:2,requestId:randomUUID(),id},{root});assert.equal(result.events.length,0);assert.equal(result.revision,3);
 const stored=JSON.parse(await fs.readFile(path.join(root,'calendar.json'),'utf8'));assert.equal(stored.events[0].createdBy,actorKey(a.userId));assert.equal(stored.events[0].updatedBy,actorKey(admin.userId));assert.ok(stored.events[0].deletedAt);
}));
test('CAS exactly one winner, retry is idempotent, request IDs scoped to actor',()=>fixture(async root=>{
 const c=create(0),out=await Promise.allSettled([companyCalendar(a,query,c,{root}),companyCalendar(b,query,create(0),{root})]);assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(out.find(r=>r.status==='rejected').reason.statusCode,409);
 const current=await companyCalendar(a,query,null,{root});
 const command=create(current.revision);let saved=await companyCalendar(a,query,command,{root});assert.equal((await companyCalendar(a,query,command,{root})).revision,saved.revision);
 await assert.rejects(companyCalendar(a,query,{...command,title:'different'},{root}),e=>e.statusCode===409);
 saved=await companyCalendar(b,query,{...command,expectedRevision:saved.revision},{root});assert.equal(saved.events.length,3,'another actor cannot replay the first actor command');
}));
test('separate years, time validation, active actor, query limits and personal data preservation',()=>fixture(async root=>{
 const personal=path.join(root,'personal'),common=path.join(root,'company');await mutatePersonalHome(a.userId,{action:'create',expectedRevision:0,requestId:'personal-test-0001',title:'개인 업무',date:'2026-11-13',startDate:'2026-11-13',weekdays:[]},{root:personal});const file=path.join(personal,(await fs.readdir(personal)).find(n=>n.endsWith('.json'))),before=await fs.readFile(file);
 await companyCalendar(a,query,create(0),{root:common});await companyCalendar(a,{month:'2025-11'},create(1,{date:'2025-11-13',title:'전년 일정'}),{root:common});assert.equal((await companyCalendar(b,{month:'2025-11'},null,{root:common})).events[0].title,'전년 일정');assert.equal((await companyCalendar(b,query,null,{root:common})).events[0].title,'회사 회의');
 assert.deepEqual(await fs.readFile(file),before);
 for(const extra of [{date:'2026-02-30'},{title:' '},{startTime:'',endTime:'10:00'},{startTime:'10:00',endTime:'09:00'},{startTime:'24:00'},{createdBy:b.userId},{note:'x'.repeat(2001)}])await assert.rejects(companyCalendar(a,query,create(2,extra),{root:common}),e=>e.statusCode===400);
 for(const user of [{},{userId:'a',accountActive:false},{userId:'service',service:true}])await assert.rejects(companyCalendar(user,query,null,{root:common}),e=>e.statusCode===403);
 for(const invalid of [null,{},[],{month:'2026-13'},{week:'2026-02-30'}])await assert.rejects(companyCalendar(a,invalid,null,{root:common}),e=>e.statusCode===400);
}));
test('corrupt storage never becomes empty or gets overwritten',()=>fixture(async root=>{
 const bytes='{broken';await fs.writeFile(path.join(root,'calendar.json'),bytes);await assert.rejects(companyCalendar(a,query,create(0),{root}),e=>e.statusCode===503);assert.equal(await fs.readFile(path.join(root,'calendar.json'),'utf8'),bytes);
}));
test('failed atomic publication preserves old bytes and removes its temporary file',()=>fixture(async root=>{
 await companyCalendar(a,query,create(0),{root});const file=path.join(root,'calendar.json'),before=await fs.readFile(file),rename=fs.rename;
 try{fs.rename=async()=>{throw Error('fixture publication failure');};await assert.rejects(companyCalendar(a,query,create(1),{root}),/publication/);}finally{fs.rename=rename;}
 assert.deepEqual(await fs.readFile(file),before);assert.deepEqual((await fs.readdir(root)).filter(n=>n.endsWith('.tmp')||n.endsWith('.lock')),[]);
}));
test('HTTP handler requires active identity, bound owner and same-origin POST',async()=>{
 const source=await fs.readFile('pages/api/desktop/company-calendar.js','utf8');const module=await import('data:text/javascript;base64,'+Buffer.from(source.replace(/^import .*;\r?\n/gm,'').replace('export default withAuth(createCompanyCalendarHandler());','')).toString('base64'));
 let calls=0;const handler=module.createCompanyCalendarHandler({workspace:async()=>{calls++;return {success:true};}}),res={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
 const req={method:'POST',user:a,headers:{origin:'https://nenovaweb.com',host:'nenovaweb.com'},body:{expectedOwnerId:a.userId,query,command:create(0)}};
 await handler({...req,user:null},res);assert.equal(res.code,403);await handler({...req,body:{...req.body,expectedOwnerId:b.userId}},res);assert.equal(res.code,403);await handler({...req,headers:{host:'nenovaweb.com'}},res);assert.equal(res.code,403);await handler({...req,headers:{origin:'https://evil.test',host:'nenovaweb.com'}},res);assert.equal(res.code,403);assert.equal(calls,0);
 await handler(req,res);assert.equal(res.code,200);assert.equal(calls,1);
});

test('large Korean notes stay below IPC byte limit and selected day is prioritized',()=>fixture(async root=>{
 const events=Array.from({length:1000},(_,i)=>({id:randomUUID(),title:'회사 일정 '+i,date:i===999?'2026-11-30':'2026-11-01',startTime:'',endTime:'',note:'한'.repeat(2000),createdBy:actorKey(a.userId),createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}));await fs.writeFile(path.join(root,'calendar.json'),JSON.stringify({schemaVersion:1,revision:1000,events,requests:{}}));const result=await companyCalendar(b,{month:'2026-11',date:'2026-11-30'},null,{root});assert.equal(result.total,1000);assert.equal(result.truncated,true);assert.ok(result.events.some(event=>event.date==='2026-11-30'));assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<2*1024*1024);
}));
