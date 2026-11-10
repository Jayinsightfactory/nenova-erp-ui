import test from 'node:test';
import assert from 'node:assert/strict';
import {planDistributionDates,nativeDateEstimate,nativeDateRound,distributionDateScope} from '../lib/shipmentDistributionDates.js';
export function dateFixture(){return {scope:{orderYear:'2026',orderWeek:'45-01',custKey:777,prodKey:3513},detail:{OutQuantity:1,Cost:11500,Amount:156818,Vat:15682,OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300,DetailFix:true,MasterFix:true},calendar:Array.from({length:7},(_,i)=>{const date=new Date(Date.UTC(2026,10,4+i));return {WeekDay:date.getUTCDay()+1,Timestamp:date.toISOString().slice(0,10)+' 00:00:00.000'};}),dates:[{Timestamp:'2026-11-06 00:00:00.000',ShipmentQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,Descr:''}]};}
const split=(a=.4,b=.6)=>[{timestamp:'2026-11-05 00:00:00.000',quantity:a},{timestamp:'2026-11-09 00:00:00.000',quantity:b}];
test('native date decimal conversion and midpoint-even money preserve totals',()=>{
 assert.deepEqual([nativeDateRound(2.5),nativeDateRound(3.5),nativeDateRound(7.5)],[2,4,8]);
 assert.equal(nativeDateEstimate(dateFixture().detail,.5),7.5);
 const p=planDistributionDates(dateFixture(),split());assert.equal(p.total,1);assert.equal(p.estimateTotal,15);assert.equal(p.gross,172500);assert.equal(p.representative,'2026-11-05 00:00:00.000');assert.equal(p.fixed,true);
});
test('each date-scope near miss is blocked before writes',()=>{
 for(const mutate of [
 c=>c.scope.orderYear='2025',c=>c.calendar[0].MatchCount=2,c=>c.calendar.pop(),c=>c.calendar.push(c.calendar[0]),c=>c.calendar[0].Timestamp='2025-11-04 00:00:00.000',c=>c.calendar[0].Timestamp='2026-11-04 12:00:00.000',c=>c.calendar[0].WeekDay=9,
 c=>c.detail.DetailFix=null,c=>c.detail.OutQuantity=0,c=>c.dates[0].ShipmentQuantity=.5,c=>c.dates[0].Timestamp='2026-11-06 01:00:00.000',c=>c.dates.push({...c.dates[0],ShipmentQuantity:0}),c=>c.dates[0].EstQuantity=null,c=>c.dates[0].Cost=11000,c=>c.dates[0].EstQuantity=14,c=>c.detail.Amount=1
 ]){const c=dateFixture();mutate(c);assert.throws(()=>planDistributionDates(c,split()));}
 for(const allocations of [split(.5,.5),split(.4,.5),split(-1,2),split(NaN,1),split(.4001,.5999),split('',1),[{timestamp:'2025-11-06 00:00:00.000',quantity:1}],Array(8).fill(split()[0]),[split()[0],split()[0]],null])assert.throws(()=>planDistributionDates(dateFixture(),allocations));
 for(const bad of [{},{orderYear:'2026',orderWeek:'45-01',custKey:0,prodKey:1},{orderYear:'2026',orderWeek:'45',custKey:1,prodKey:1}])assert.throws(()=>distributionDateScope(bad));
});
test('explicit zero price, unsplit midpoint, unit conversion and missing factor',()=>{
 const c=dateFixture();c.detail.Cost=0;c.detail.Amount=0;c.detail.Vat=0;Object.assign(c.dates[0],{Cost:0,Amount:0,Vat:0});assert.equal(planDistributionDates(c,split()).gross,0);
 assert.equal(nativeDateEstimate({...c.detail,OutUnit:'단',EstUnit:'송이'},2),40);
 assert.equal(nativeDateEstimate({...c.detail,OutUnit:'송이',EstUnit:'박스'},300),1);
 assert.throws(()=>nativeDateEstimate({...c.detail,BunchOf1Box:0},1));
});

test('native per-date supply/VAT rounding is visible while gross and detail money stay fixed',()=>{
 const c=dateFixture();Object.assign(c.detail,{BunchOf1Box:20,EstQuantity:20,Amount:209091,Vat:20909});Object.assign(c.dates[0],{EstQuantity:20,Amount:209091,Vat:20909});
 const before=JSON.stringify(c);const p=planDistributionDates(c,split(.5,.5));assert.equal(p.gross,230000);assert.equal(p.amountDelta,-1);assert.equal(JSON.stringify(c),before);
});
