import test from 'node:test';
import assert from 'node:assert/strict';
import {personalHomeCalendar} from '../lib/personalHomeStore.js';
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
