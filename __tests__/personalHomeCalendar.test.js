import test from 'node:test';
import assert from 'node:assert/strict';
import {personalHomeCalendar,personalHomeWeek,personalHomeCurrentTasks,personalHomeTasks} from '../lib/personalHomeStore.js';
const rule=(frequency,startDate,extra={})=>({versions:[{effectiveFrom:startDate,startDate,title:'test',frequency,weekdays:[],monthDay:Number(startDate.slice(8))}],occurrences:{},...extra});
test('calendar counts exact occurrences with leap/month-end/year boundaries and no carry',()=>{
 const record={rules:[rule('monthly','2024-01-31'),rule('once','2024-01-01'),rule('daily','2024-02-28',{stoppedFrom:'2024-03-01',occurrences:{'2024-02-28':{archived:true},'2024-02-29':{done:true}}})]};
 const feb=personalHomeCalendar(record,'2024-02');assert.equal(feb.days.length,29);assert.equal(feb.days[27].total,0);assert.deepEqual(feb.days[28],{date:'2024-02-29',total:2,done:1});
 assert.equal(personalHomeCalendar(record,'2025-02').days[27].total,1);assert.equal(personalHomeCalendar(record,'2025-01').days[30].total,1);
 assert.equal(personalHomeCalendar(record,'2024-03').days[0].total,0);
 const frozen=JSON.stringify(record);personalHomeCalendar(record,'2024-12');assert.equal(JSON.stringify(record),frozen);
 for(const invalid of ['2024-13','2024-2','1999-12','2101-01',[],null])assert.throws(()=>personalHomeCalendar(record,invalid));
});
test('historical occurrence snapshot remains even after recurrence stops',()=>{
 const record={rules:[rule('daily','2026-12-31',{stoppedFrom:'2027-01-01',occurrences:{'2027-01-02':{snapshot:{title:'old'},done:true}}})]};
 const jan=personalHomeCalendar(record,'2027-01');assert.equal(jan.days[0].total,0);assert.deepEqual(jan.days[1],{date:'2027-01-02',total:1,done:1});
});

test('weekly schedule crosses years, preserves exact times/snapshots and caps projection without writes',()=>{
 const record={rules:[rule('daily','2026-12-30',{id:'test',occurrences:{'2027-01-01':{snapshot:{title:'보존',startTime:'09:30',endTime:'11:00'},done:true},'2027-01-02':{archived:true}}})]};
 record.rules[0].versions[0].startTime='08:00';record.rules[0].versions[0].endTime='09:00';const before=JSON.stringify(record),week=personalHomeWeek(record,'2027-01-01');assert.equal(week.start,'2026-12-28');assert.equal(week.days.length,7);assert.equal(week.days[0].tasks.length,0);assert.deepEqual(week.days[4].tasks[0],{id:'test',title:'보존',startTime:'09:30',endTime:'11:00',done:true});assert.equal(week.days[5].tasks.length,0);assert.equal(JSON.stringify(record),before);
 const crowded=personalHomeWeek({rules:Array.from({length:101},()=>rule('daily','2026-01-01'))},'2026-11-13');assert.equal(crowded.days[0].tasks.length,100);assert.equal(crowded.days[0].more,1);assert.throws(()=>personalHomeWeek(record,'2027-02-30'));
});

test('weekly edge cells outside the supported 2000–2100 dates stay empty',()=>{
 const record={rules:[rule('daily','2000-01-01')]};const last=personalHomeWeek(record,'2100-12-31');assert.ok(last.days.filter(d=>d.date>'2100-12-31').every(d=>d.total===0));const first=personalHomeWeek(record,'2000-01-01');assert.ok(first.days.filter(d=>d.date<'2000-01-01').every(d=>d.total===0));
});

test('monthly daily previews are bounded, time sorted and contain no private source fields',()=>{
 const make=(id,startTime,title)=>rule('daily','2026-11-01',{id,versions:[{effectiveFrom:'2026-11-01',startDate:'2026-11-01',frequency:'daily',weekdays:[],title,startTime,private:'secret'}]});
 const record={rules:[make('a','','미정'),make('b','14:00','오후'),make('c','09:00','오전')]};const day=personalHomeCalendar(record,'2026-11',{preview:true}).days[0];assert.equal(day.total,3);assert.deepEqual(day.preview,[{id:'c',title:'오전',startTime:'09:00',done:false},{id:'b',title:'오후',startTime:'14:00',done:false}]);
});

test('current list keeps one latest occurrence per recurring rule without changing history or calendar',()=>{
 const r=(id,title,frequency,startDate,weekdays=[])=>({id,versions:[{effectiveFrom:startDate,startDate,title,frequency,weekdays,startTime:'09:00',endTime:'',shortcut:null}],occurrences:{}});
 const record={revision:3,rules:[r('once','단가표','once','2026-11-16'),r('price','단가표','weekly','2026-11-23',[1]),r('volume','물량표','weekly','2026-11-16',[1])]};
 const before=JSON.stringify(record);
 const page=personalHomeCurrentTasks(record,'2026-11-30');
 assert.equal(page.totalTasks,3);assert.equal(new Set(page.tasks.map(t=>t.id)).size,3);
 assert.equal(page.tasks.find(t=>t.id==='volume').occurrenceDate,'2026-11-30');
 assert.equal(page.tasks.find(t=>t.id==='price').occurrenceDate,'2026-11-30');
 assert.equal(personalHomeTasks(record,'2026-11-30').totalTasks,6,'raw historical view preserved');
 assert.equal(personalHomeCalendar(record,'2026-11').days[29].total,2);
 assert.equal(JSON.stringify(record),before,'projection never changes saved data');
 const first=personalHomeCurrentTasks(record,'2026-11-30',{limit:2}),second=personalHomeCurrentTasks(record,'2026-11-30',{offset:first.nextOffset,limit:2});
 assert.deepEqual([...first.tasks,...second.tasks].map(t=>t.id),page.tasks.map(t=>t.id));
 record.rules[2].occurrences['2026-11-30']={done:true};
 assert.equal(personalHomeCurrentTasks(record,'2026-11-30').tasks.find(t=>t.id==='volume').done,true);
 assert.equal(personalHomeCurrentTasks(record,'2026-12-01').tasks.some(t=>t.id==='volume'),false,'old pending occurrences never resurrect');
 const next=personalHomeCurrentTasks(record,'2026-12-07').tasks.find(t=>t.id==='volume');assert.equal(next.occurrenceDate,'2026-12-07');assert.equal(next.done,false);
 assert.equal(personalHomeCurrentTasks(record,'2026-11-16').tasks.find(t=>t.id==='volume').done,false,'past completion remains independent');
});
test('current recurrence projection handles month-end, year boundary, stop, archive, versions and long series',()=>{
 const r={id:'monthly',versions:[{effectiveFrom:'2024-01-31',startDate:'2024-01-31',title:'월말',frequency:'monthly',monthDay:31,weekdays:[]}],occurrences:{}};
 const record={revision:0,rules:[r]};
 assert.equal(personalHomeCurrentTasks(record,'2025-03-01').tasks[0].occurrenceDate,'2025-02-28');
 assert.equal(personalHomeCurrentTasks(record,'2027-01-01').tasks[0].occurrenceDate,'2026-12-31');
 r.stoppedFrom='2025-01-01';assert.equal(personalHomeCurrentTasks(record,'2025-03-01').tasks[0].occurrenceDate,'2024-12-31');
 r.occurrences['2024-12-31']={archived:true};assert.equal(personalHomeCurrentTasks(record,'2025-03-01').tasks[0].archived,true);
 r.occurrences['2024-12-31']={done:true};assert.equal(personalHomeCurrentTasks(record,'2025-03-01').tasks.length,0);
 const daily={id:'daily',versions:[{effectiveFrom:'2000-01-01',startDate:'2000-01-01',title:'매일',frequency:'daily',weekdays:[0,1,2,3,4,5,6]}],occurrences:{}};
 assert.equal(personalHomeCurrentTasks({revision:0,rules:[daily]},'2100-12-31').totalTasks,1);
});
