import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {companyCalendar} from '../lib/companyCalendarStore.js';
import {mutatePersonalHome,personalHomeTaskAt,personalHomeCalendar,personalHomeWeek} from '../lib/personalHomeStore.js';
import holidayData from '../lib/calendarHolidays.cjs';
import {desktopHomeWorkspace} from '../lib/desktopHomeWorkspace.js';
const query={month:'2026-11',date:'2026-11-18'},a={userId:'calendar-owner',accountActive:true},b={userId:'calendar-other',accountActive:true};
const command=(revision,more={})=>({action:'create',requestId:randomUUID(),expectedRevision:revision,title:'일정 연습',date:'2026-11-18',startTime:'09:00',...more});
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'calendar-detail-test-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('all requested countries have public holidays, year boundaries stay date-only, China full holiday and workday dates are distinct',()=>{
 const result=holidayData.calendarHolidays(new Set(['2026-01-01','2026-02-23','2026-02-28','2026-05-05','2027-01-01','2027-02-13','2027-02-14']));
 assert.equal(result.countries.length,12);
 for(const country of ['CO','CN','NL','IT','TH','VN','JP','US','EC','ET','AU'])assert.ok(result.countries.some(c=>c.code===country));
 for(const date of ['2026-02-23','2027-02-13'])assert.ok(result.entries.some(h=>h.country==='CN'&&h.date===date&&h.kind==='holiday'));
 for(const date of ['2026-02-28','2027-02-14'])assert.ok(result.entries.some(h=>h.country==='CN'&&h.date===date&&h.kind==='workday'));
 assert.ok(result.entries.some(h=>h.country==='NL'&&h.date==='2026-05-05'&&h.name==='해방기념일'));
 assert.ok(result.entries.every(h=>/^\d{4}-\d{2}-\d{2}$/.test(h.date)));
});
test('private calendar details stay owner-only, older clients preserve privacy, publication creates a shared addition marker',()=>fixture(async root=>{
 const details={location:'연습 회의실',attendees:'참석자 연습',availability:'free',reminderMinutes:10};
 const first=await companyCalendar(a,query,command(0,{visibility:'private',details}),{root});const event=first.events[0];
 assert.equal(event.details.location,details.location);assert.equal(first.latestAdditionRevision,0);
 assert.deepEqual((await companyCalendar(b,query,null,{root})).events,[]);
 assert.deepEqual((await companyCalendar({userId:'nenovaSS3',accountActive:true},query,null,{root})).events,[]);
 await assert.rejects(companyCalendar(b,query,{...command(1),action:'update',id:event.id},{root}),/등록자/);
 const legacy=await companyCalendar(a,query,{...command(1),action:'update',id:event.id,title:'이전 앱 수정'},{root});
 assert.equal(legacy.events[0].visibility,'private');assert.equal(legacy.events[0].details.location,details.location);
 const published=await companyCalendar(a,query,{...command(2),action:'update',id:event.id,visibility:'company'},{root});
 assert.equal(published.latestAdditionRevision,3);assert.equal((await companyCalendar(b,query,null,{root})).events.length,1);
}));
test('weekly edit retains details and next-year first-cycle reset without creating duplicate series rows',()=>fixture(async root=>{
 const first=await companyCalendar(a,{month:'2027-01'},command(0,{date:'2026-11-25',title:'네덜란드 1차 주문등록',weekly:{endDate:'2026-11-27',deadline:'2027-01-20',resetDate:'2027-01-06'},details:{location:'연습 장소'}}),{root});
 const event=first.events.find(e=>e.date==='2027-01-06');assert.equal(event.title,'네덜란드 1차 주문등록');
 const changed=await companyCalendar(a,{month:'2027-01'},{...command(1),action:'update',id:event.id,title:event.weekly.title,date:event.weekly.startDate,weekly:{endDate:event.weekly.endDate,deadline:event.weekly.deadline,resetDate:event.weekly.resetDate},recurringEdit:true,details:{location:'변경 장소'}},{root});
 assert.equal(changed.events.find(e=>e.date==='2027-01-13').title,'네덜란드 2차 주문등록');
 assert.equal(new Set(changed.events.map(e=>e.id)).size,1);assert.ok(changed.events.every(e=>e.details.location==='변경 장소'));
}));
test('personal task detail edits persist and calendar titles update; focus lookup cannot read another owner record',()=>fixture(async root=>{
 const first=await mutatePersonalHome(a.userId,{...command(0),date:'2026-11-18',startDate:'2026-11-18',frequency:'daily',weekdays:[0,1,2,3,4,5,6]},{root});const id=first.rules[0].id;
 const updated=await mutatePersonalHome(a.userId,{...command(1),action:'update',taskId:id,title:'변경 제목',details:{note:'메모 연습',color:'#be365c',reminderMinutes:0}},{root});
 assert.equal(personalHomeTaskAt(updated,'2026-11-18',id).details.note,'메모 연습');
 assert.equal(personalHomeCalendar(updated,'2026-11',{preview:true}).days.find(d=>d.date==='2026-11-18').preview[0].title,'변경 제목');
 assert.equal(personalHomeWeek(updated,'2026-11-18').days.find(d=>d.date==='2026-11-18').tasks[0].title,'변경 제목');
 assert.equal(personalHomeTaskAt({rules:[]},'2026-11-18',id),null);
 await assert.rejects(mutatePersonalHome(a.userId,{...command(2),action:'update',taskId:id,details:{reminderMinutes:10},startTime:''},{root}),/시작 시간/);
}));
test('opening an exact personal calendar occurrence never waits on guidance or feedback providers',()=>fixture(async root=>{
 const seeded=await mutatePersonalHome(a.userId,{...command(0),date:'2026-11-18',startDate:'2026-11-18'},{root});let providers=0;
 const dependencies={root,readKnowledge:async()=>{providers++;throw Error('must not run');},loadQuality:async()=>{providers++;throw Error('must not run');}};
 const result=await desktopHomeWorkspace(a,{date:'2026-11-18',focusTaskId:seeded.rules[0].id},null,dependencies);
 assert.equal(result.focusedTask.title,'일정 연습');assert.equal(providers,0);
 const other=await desktopHomeWorkspace(b,{date:'2026-11-18',focusTaskId:seeded.rules[0].id},null,dependencies);assert.equal(other.focusedTask,null);assert.equal(providers,0);
}));
