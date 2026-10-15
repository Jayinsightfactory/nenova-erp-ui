import assert from 'node:assert/strict';
import { buildWeekdayPrintRequests as requestsFor, validateWeekdayPrintResponse as validate,
  buildWeekdayEstimatePrintBundle as bundle } from '../lib/weekdayEstimatePrintBundle.js';
import { buildEstimateHtml } from '../lib/estimatePrintHtml.js';
import { shiftDate } from '../lib/weekdayEstimateCycle.js';

const cycle={offset:-1,year:2026,majorWeek:'38',calendarState:'FOUND',days:Array.from({length:7},(_,i)=>({date:shiftDate('2026-09-17',i),calendarState:'FOUND'}))};
const dates=['2026-09-17','2026-09-18'];
const input={cycle,custKey:533,mode:'dates',dates:[...dates].reverse()};
const requests=requestsFor(input);
assert.deepEqual(requests.map(request=>request.dates),dates.map(date=>[date]),'two days require two one-day API reads, not a combined quantity query');
assert.ok(requests.every(request=>request.year===2026 && request.majorWeek==='38' && request.custKey===533));
assert.ok(requests.every(request=>request.source==='ALLOCATION'),'print requests explicitly select saved allocation source');
assert.equal(requestsFor({...input,dates:[...dates,dates[0]]}).length,2,'canonical API date dedup is preserved');
assert.equal(requestsFor({...input,dates:cycle.days.map(day=>day.date)}).length,7);
for(const bad of [{dates:[]},{dates:[...cycle.days.map(day=>day.date),'2026-09-24']},{dates:['2026-02-30']},{custKey:0},{mode:'all'},
  {cycle:{...cycle,calendarState:'MISSING'}},{cycle:{...cycle,days:cycle.days.map(day=>({...day,calendarState:'AMBIGUOUS'}))}}]) assert.throws(()=>requestsFor({...input,...bad}));
const printDate='2026-10-01',logoDataUrl='data:image/png;base64,fixture';
const item=(quantity,amount,vat)=>({_exePrint:true,_exeParity:true,ProdKey:866,ProdName:'CARNATION <fixture>',Quantity:quantity,UnitQuantity:`${quantity}송이`,Cost:100,Amount:amount,Vat:vat,EstimateType:'정상출고'});
const response=(scope,items)=>({success:true,readOnly:true,draftIncluded:false,source:'ALLOCATION',scope,customer:{CustKey:533,CustName:'주광 <농원>'},items,confirmation:{required:false,fixedCount:0,unfixedCount:items.length,unknownCount:0},note:'선택 날짜 저장 분배'});
const results=[response(requests[0],[item(70,6364,636)]),response(requests[1],[item(200,18182,1818)])];
const before=JSON.stringify({requests,results});
const built=bundle({requests,results,printDate,logoDataUrl});
assert.equal(built.documentCount,2);assert.equal(built.count,2);assert.deepEqual(built.emptyDates,[]);
assert.match(built.note,/2026-09-17 출고 상태: 확정 0건 \/ 미확정 1건/,'unfixed allocation prints with explicit status, never a confirmed-copy label');
assert.equal((built.html.match(/<head>/g)||[]).length,1);assert.equal((built.html.match(/<body>/g)||[]).length,1);
assert.equal((built.html.match(/<h1>견 적 서<\/h1>/g)||[]).length,2,'each day retains its own EXE quote header');
const sections=[...built.html.matchAll(/<section class="weekday-print-page" data-print-date="([^"]+)">([\s\S]*?)<\/section>/g)];
assert.deepEqual(sections.map(section=>section[1]),dates);
assert.match(sections[0][2],/70송이/);assert.match(sections[0][2],/6,364/);assert.doesNotMatch(sections[0][2],/200송이|18,182/);
assert.match(sections[1][2],/200송이/);assert.match(sections[1][2],/18,182/);assert.doesNotMatch(sections[1][2],/70송이|6,364/);
assert.ok(sections[0][2].includes('주광 &lt;농원&gt;'));assert.doesNotMatch(built.html,/<fixture>|<농원>/);
assert.match(built.html,/body \{ padding:0; \}/);
assert.match(built.html,/\.weekday-print-page \{ padding:10mm 15mm; break-before:page; page-break-before:always; \}/);
assert.match(built.html,/first-child \{ break-before:auto; page-break-before:auto; \}/);
assert.match(built.html,/font-size:9pt; padding:10mm 15mm/);assert.match(built.html,/\.item-table tbody td \{ font-size:8pt/);assert.match(built.html,/h1[^}]*font-size:16pt/);
assert.equal(JSON.stringify({requests,results}),before,'request scopes and server quantities/amounts remain immutable');

const single=bundle({requests:[requests[0]],results:[results[0]],printDate,logoDataUrl});
assert.equal(single.html,buildEstimateHtml({bigoLabel:'38차 2026-09-17 · 분배 기준',custName:results[0].customer.CustName,rows:results[0].items,printDate,logoDataUrl,nativeLayout:true}),'single-day HTML uses the opt-in native geometry');
assert.doesNotMatch(single.html,/weekday-print-page/);
const major=requestsFor({...input,mode:'major'});
assert.equal(major.length,1);assert.deepEqual(major[0].dates,[]);
const majorResult=response(major[0],results.flatMap(result=>result.items));
assert.equal(bundle({requests:major,results:[majorResult],printDate,logoDataUrl}).html,buildEstimateHtml({bigoLabel:'38차 전체 견적 · 분배 기준',custName:majorResult.customer.CustName,rows:majorResult.items,printDate,logoDataUrl,nativeLayout:true}),'major HTML also uses native geometry');
const someEmpty=bundle({requests,results:[results[0],response(requests[1],[])],printDate,logoDataUrl});
assert.equal(someEmpty.documentCount,1);assert.deepEqual(someEmpty.emptyDates,[dates[1]]);assert.match(someEmpty.note,/2026-09-18: 저장된 분배 자료 없음/);
assert.equal((someEmpty.html.match(/<h1>/g)||[]).length,1,'empty day must not fabricate a zero quote');
const allEmpty=bundle({requests,results:requests.map(request=>response(request,[])),printDate,logoDataUrl});
assert.equal(allEmpty.html,'');assert.equal(allEmpty.documentCount,0);assert.match(allEmpty.note,/2026-09-17 · 2026-09-18: 저장된 분배 자료 없음/);
for(const bad of [
  {...results[1],source:undefined},{...results[1],source:'ESTIMATE'},
  {...results[1],confirmation:undefined},{...results[1],confirmation:{...results[1].confirmation,required:true}},
  {...results[1],success:false},{...results[1],readOnly:false},{...results[1],draftIncluded:true},
  {...results[1],scope:{...requests[1],year:2025}},{...results[1],scope:{...requests[1],majorWeek:'37'}},
  {...results[1],scope:{...requests[1],orderYearWeek:'202538'}},{...results[1],scope:{...requests[1],custKey:534}},
  {...results[1],scope:{...requests[1],mode:'major'}},{...results[1],scope:{...requests[1],dates:[dates[0]]}},
  {...results[1],customer:{CustKey:534,CustName:'다른업체'}},{...results[1],items:null},
  {...results[1],items:[{...results[1].items[0],Quantity:null}]},{...results[1],items:[{...results[1].items[0],Amount:NaN}]},
]) assert.throws(()=>bundle({requests,results:[results[0],bad],printDate,logoDataUrl}),/응답|범위/,'one invalid day fails the whole bundle');
assert.throws(()=>bundle({requests,results:[results[0]],printDate,logoDataUrl}),/모든 선택/);
assert.throws(()=>bundle({requests:[requests[0],requests[0]],results:[results[0],results[0]],printDate,logoDataUrl}),/중복/);
assert.throws(()=>bundle({requests,results:[results[0],{...results[1],customer:{...results[1].customer,CustName:'변경된 업체'}}],printDate,logoDataUrl}),/거래처 표시값/);
assert.throws(()=>bundle({requests:[{...requests[0],dates:['2026-09-17"><script>']}],results:[results[0]],printDate,logoDataUrl}),/정규 전산 날짜/);
assert.equal(validate(requests[0],results[0]),results[0]);
assert.throws(()=>validate({...requests[0],source:'ESTIMATE'},results[0]),/응답/,'legacy confirmed-quote request cannot consume allocation result');
console.log('weekdayEstimatePrintBundle: per-date requests/isolated quantity+amount/2 headers+page sections/common typography/single+major exact HTML/empty notice/partial+scope failure/7-day limit PASS');
