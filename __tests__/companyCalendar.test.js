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
test('new company additions notify outside the displayed period, updates and deletion keep the addition marker',()=>fixture(async root=>{
 const first=await companyCalendar(a,query,create(0,{date:'2027-01-06'}),{root});
 assert.equal(first.events.length,0);
 assert.equal(first.latestAdditionRevision,1);
 const future=await companyCalendar(a,{date:'2027-01-06'},null,{root});
 const id=future.events[0].id;
 const updated=await companyCalendar(a,query,{...create(1,{date:'2027-01-06'}),action:'update',id},{root});
 assert.equal(updated.latestAdditionRevision,1);
 const deleted=await companyCalendar(a,query,{action:'delete',id,expectedRevision:2,requestId:randomUUID()},{root});
 assert.equal(deleted.latestAdditionRevision,1);
 const next=await companyCalendar(b,query,create(3),{root});
 assert.equal(next.latestAdditionRevision,4);
}));
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

test('colors persist, normalize and remain intact for older editors and colorless storage',()=>fixture(async root=>{
 let result=await companyCalendar(a,query,create(0,{color:'#A13BCD'}),{root});
 const id=result.events[0].id;assert.equal(result.events[0].color,'#a13bcd');
 result=await companyCalendar(b,query,null,{root});assert.equal(result.events[0].color,'#a13bcd');assert.equal(result.events[0].title,'회사 회의');
 result=await companyCalendar(a,query,{...create(1,{title:'구버전 수정'}),action:'update',id},{root});assert.equal(result.events[0].color,'#a13bcd');
 result=await companyCalendar(admin,query,{...create(2,{color:'#FF8800'}),action:'update',id},{root});assert.equal(result.events[0].color,'#ff8800');
 const file=path.join(root,'calendar.json'),stored=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(stored.events[0].color,'#ff8800');delete stored.events[0].color;await fs.writeFile(file,JSON.stringify(stored));
 const before=await fs.readFile(file);result=await companyCalendar(b,query,null,{root});assert.equal(result.events[0].color,'#267b4c');assert.deepEqual(await fs.readFile(file),before,'reading legacy records does not migrate or change revision');
 result=await companyCalendar(a,query,create(3),{root});assert.equal(result.events[1].color,'#267b4c');assert.equal(result.schemaVersion,1);
 for(const color of ['',null,123,'red','#abc','#12345678','var(--color)','url(x)'])await assert.rejects(companyCalendar(a,query,create(4,{color}),{root}),e=>e.statusCode===400);
 assert.equal((await companyCalendar(a,query,null,{root})).revision,4);
 await assert.rejects(companyCalendar(b,query,{...create(4,{color:'#123456'}),action:'update',id},{root}),e=>e.statusCode===403);
 const edit={...create(4,{color:'#123456'}),action:'update',id};result=await companyCalendar(a,query,edit,{root});assert.equal((await companyCalendar(a,query,edit,{root})).revision,result.revision);
 await assert.rejects(companyCalendar(a,query,{...edit,color:'#654321'},{root}),e=>e.statusCode===409);
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

const series=(revision,extra={})=>create(revision,{title:'선주문 1차',date:'2026-11-25',color:'#7c3aed',weekly:{endDate:'2026-11-27',deadline:'2027-01-08'},...extra});
test('weekly ranges increment only title ordinal across months and years, with explicit deadline inclusion',()=>fixture(async root=>{
 const command=series(0);let result=await companyCalendar(a,{month:'2026-11'},command,{root});assert.deepEqual(result.events.map(e=>e.date),['2026-11-25','2026-11-26','2026-11-27']);assert.ok(result.events.every(e=>e.title==='선주문 1차'));const id=result.events[0].id;
 assert.deepEqual(result.events[0].weekly,{startDate:'2026-11-25',endDate:'2026-11-27',deadline:'2027-01-08',inclusive:false,title:'선주문 1차'});
 result=await companyCalendar(b,{month:'2026-12',week:'2026-12-30',date:'2026-12-30'},null,{root});assert.equal(result.total,15);assert.equal(result.events.find(e=>e.date==='2026-12-30').title,'선주문 6차');assert.equal(new Set(result.events.map(e=>e.id+e.date)).size,result.events.length);assert.ok(result.events.every(e=>e.id===id&&e.color==='#7c3aed'&&!e.canEdit));
 result=await companyCalendar(a,{month:'2027-01'},null,{root});assert.deepEqual(result.events.map(e=>[e.date,e.title]),[['2027-01-01','선주문 6차'],['2027-01-06','선주문 7차'],['2027-01-07','선주문 7차']]);
 const file=path.join(root,'calendar.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(raw.events.length,1);assert.equal(raw.events[0].date,'2026-11-25');assert.equal('startNumber'in raw.events[0].weekly,false);assert.ok((await fs.stat(file)).size<2000);
 const update={...series(1,{weekly:{endDate:'2026-11-27',deadline:'2027-01-08',inclusive:true}}),action:'update',id,recurringEdit:true};result=await companyCalendar(a,{date:'2027-01-08'},update,{root});assert.equal(result.events[0].title,'선주문 7차');assert.equal(result.events[0].weekly.inclusive,true);assert.equal((await companyCalendar(a,{date:'2027-01-08'},update,{root})).revision,2);
}));

test('weekly edits require explicit whole-series acknowledgement and preserve permissions, CAS and retry',()=>fixture(async root=>{
 const command=series(0);let result=await companyCalendar(a,{date:'2026-11-25'},command,{root});const id=result.events[0].id,file=path.join(root,'calendar.json'),before=await fs.readFile(file);
 const oldUpdate={...create(1),action:'update',id},remove={action:'delete',expectedRevision:1,requestId:randomUUID(),id};
 for(const edit of [oldUpdate,remove,{...oldUpdate,recurringEdit:true}])await assert.rejects(companyCalendar(a,query,edit,{root}),e=>e.statusCode===409);
 assert.deepEqual(await fs.readFile(file),before);
 await assert.rejects(companyCalendar(b,query,{...remove,recurringEdit:true},{root}),e=>e.statusCode===403);
 const edit={...series(1,{color:'#2563eb'}),action:'update',id,recurringEdit:true};const race=await Promise.allSettled([companyCalendar(a,query,edit,{root}),companyCalendar(admin,query,{...edit,requestId:randomUUID()},{root})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.statusCode,409);
 const del={...remove,requestId:randomUUID(),expectedRevision:2,recurringEdit:true};result=await companyCalendar(admin,query,del,{root});assert.equal(result.revision,3);assert.equal((await companyCalendar(admin,query,del,{root})).revision,3);assert.equal((await companyCalendar(a,{month:'2027-01'},null,{root})).events.length,0);
 assert.equal((await companyCalendar(a,query,command,{root})).revision,3,'older accepted create replay cannot resurrect a deleted series');
 await assert.rejects(companyCalendar(a,query,{...command,weekly:{...command.weekly,inclusive:true}},{root}),e=>e.statusCode===409);
}));

test('weekly validation rejects ambiguous ordinals and malformed ranges without rewriting one-time events',()=>fixture(async root=>{
 await companyCalendar(a,query,create(0),{root});const file=path.join(root,'calendar.json'),before=await fs.readFile(file),id=JSON.parse(before).events[0].id;
 for(const extra of [{title:'회의'},{title:'0차 회의'},{title:'1차 2차 회의'},{title:'9007199254740992차'},{title:'9007199254740991차'},{weekly:null},{weekly:[]},{weekly:{endDate:'2026-11-24',deadline:'2027-01-08'}},{weekly:{endDate:'2026-12-02',deadline:'2027-01-08'}},{weekly:{endDate:'2026-11-27',deadline:'2026-11-25'}},{weekly:{endDate:'2026-11-27',deadline:'2027-02-30'}},{weekly:{endDate:'2026-11-27',deadline:'2027-01-08',inclusive:'true'}},{weekly:{endDate:'2026-11-27',deadline:'2027-01-08',startNumber:1}}])await assert.rejects(companyCalendar(a,query,series(1,extra),{root}),e=>e.statusCode===400);
 await assert.rejects(companyCalendar(a,query,{...series(1),action:'update',id,recurringEdit:true},{root}),e=>e.statusCode===409);assert.deepEqual(await fs.readFile(file),before);
 const padded=series(1,{title:'2026 계획 001차',weekly:{endDate:'2026-11-25',deadline:'2026-12-03'}});const result=await companyCalendar(a,{date:'2026-12-02'},padded,{root});assert.equal(result.events[0].title,'2026 계획 002차');assert.equal((await companyCalendar(a,{date:'2026-11-26'},null,{root})).events.length,0);
}));

test('century-long weekly series stores one record and projects only the requested days with response limits',()=>fixture(async root=>{
 const command=series(0,{date:'2000-01-01',weekly:{endDate:'2000-01-07',deadline:'2100-12-31',inclusive:true},note:'한'.repeat(2000)});await companyCalendar(a,{date:'2000-01-01'},command,{root});
 const file=path.join(root,'calendar.json'),before=await fs.readFile(file);assert.equal(JSON.parse(before).events.length,1);assert.ok(before.length<10000);
 const result=await companyCalendar(b,{month:'2100-12',date:'2100-12-31'},null,{root});assert.equal(result.total,31);assert.equal(result.events.length,31);assert.equal(result.truncated,false);assert.ok(result.events.every(e=>e.date.startsWith('2100-12')));assert.deepEqual(await fs.readFile(file),before);
 const raw=JSON.parse(before);raw.events=Array.from({length:300},()=>({...raw.events[0],id:randomUUID()}));await fs.writeFile(file,JSON.stringify(raw));const bounded=await companyCalendar(b,{month:'2100-12',date:'2100-12-31'},null,{root});assert.equal(bounded.total,9300);assert.equal(bounded.truncated,true);assert.ok(bounded.events.every(e=>e.date==='2100-12-31'),'selected day is prioritized before applying IPC byte cap');assert.ok(Buffer.byteLength(JSON.stringify(bounded))<2*1024*1024);
}));

test('explicit reset date starts a new ordinal cycle at the next range start without splitting a week',()=>fixture(async root=>{
 let result=await companyCalendar(a,{month:'2027-01'},series(0,{weekly:{endDate:'2026-11-27',deadline:'2027-01-23',resetDate:'2027-01-06'}}),{root});const id=result.events[0].id;
 const titleOn=async date=>(await companyCalendar(a,{date},null,{root})).events[0]?.title;
 assert.equal(await titleOn('2026-12-30'),'선주문 6차');assert.equal(await titleOn('2027-01-01'),'선주문 6차');assert.equal(await titleOn('2027-01-06'),'선주문 1차');assert.equal(await titleOn('2027-01-08'),'선주문 1차');assert.equal(await titleOn('2027-01-13'),'선주문 2차');assert.equal(result.events[0].weekly.resetDate,'2027-01-06');
 const edit={...series(1,{title:'선주문 12차',weekly:{endDate:'2026-11-27',deadline:'2027-01-23',resetDate:'2027-01-07'}}),action:'update',id,recurringEdit:true};await companyCalendar(a,query,edit,{root});assert.equal(await titleOn('2027-01-06'),'선주문 18차');assert.equal(await titleOn('2027-01-07'),'선주문 18차');assert.equal(await titleOn('2027-01-08'),'선주문 18차');assert.equal(await titleOn('2027-01-13'),'선주문 1차');assert.equal(await titleOn('2027-01-20'),'선주문 2차');
 const file=path.join(root,'calendar.json'),before=await fs.readFile(file);for(const resetDate of ['2026-11-25','2026-11-24','2027-01-22','2027-01-23','2027-01-24','2027-02-30','',null])await assert.rejects(companyCalendar(a,query,{...edit,expectedRevision:2,requestId:randomUUID(),weekly:{...edit.weekly,resetDate}},{root}),e=>e.statusCode===400);assert.deepEqual(await fs.readFile(file),before);
}));

test('ordinal validation checks maximum both before and after reset, and omitted reset preserves the old cycle',()=>fixture(async root=>{
 const maximum=series(0,{title:'9007199254740991차',weekly:{endDate:'2026-11-25',deadline:'2026-12-10',resetDate:'2026-12-02'}});let result=await companyCalendar(a,{date:'2026-12-02'},maximum,{root});assert.equal(result.events[0].title,'1차');
 await assert.rejects(companyCalendar(a,query,series(1,{title:'9007199254740991차',weekly:{endDate:'2026-11-25',deadline:'2026-12-10',resetDate:'2026-12-03'}}),{root}),e=>e.statusCode===400);
 await assert.rejects(companyCalendar(a,query,series(1,{title:'x'.repeat(118)+'1차',weekly:{endDate:'2026-11-25',deadline:'2027-03-01',resetDate:'2026-12-02'}}),{root}),e=>e.statusCode===400);
 result=await companyCalendar(a,{date:'2027-01-06'},series(1),{root});assert.equal(result.events[0].title,'선주문 7차');assert.equal('resetDate'in result.events[0].weekly,false);
}));
