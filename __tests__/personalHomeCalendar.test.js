import test from 'node:test';
import assert from 'node:assert/strict';
import {personalHomeCalendar,personalHomeWeek} from '../lib/personalHomeStore.js';
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
