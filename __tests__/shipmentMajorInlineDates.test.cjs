const test=require('node:test'),assert=require('node:assert/strict');
const calendar=Array.from({length:7},(_,i)=>{const d=new Date(Date.UTC(2026,10,4+i));return {Timestamp:d.toISOString().slice(0,10)+' 00:00:00.000',WeekDay:d.getUTCDay()+1,MatchCount:1};});
const base={OrderYear:'2026',OrderWeek:'45-01',CustKey:1,ProdKey:3513,SdetailKey:1,OutQuantity:1,OutUnit:'박스',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300,Timestamp:calendar[2].Timestamp,ShipmentQuantity:1};
const second={...base,OrderWeek:'45-02',SdetailKey:2,OutQuantity:2,ShipmentQuantity:2,Timestamp:calendar[3].Timestamp};
test('actual updated guide has numbered chapters/captions and bounded camera on all six workflow steps',()=>{
 const fs=require('node:fs'),{cameraFilters}=require('../scripts/lib/workflow-guide-recorder.cjs');
 const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8')),wf=registry.workflows.find(w=>w.id==='shipment-distribution-dates'),guide=wf.guides[0];
 const proof=JSON.parse(fs.readFileSync('public'+guide.proof,'utf8'));assert.equal(proof.browserZoom,100);assert.equal(proof.productionWrites,0);assert.equal(proof.presentation.numberedSteps,6);
 assert.deepEqual([...new Set(proof.presentation.focusShots.map(s=>s.number))],[1,2,3,4,5,6]);cameraFilters(proof.presentation.focusShots);
 assert.deepEqual(guide.chapters.map(c=>c.scenario),['country','favorites','dates','save','tab','customers']);guide.chapters.forEach((c,i)=>assert(c.title.startsWith((i+1)+'. ')));
 const cues=fs.readFileSync('public'+guide.captions,'utf8').split(/\r?\n\r?\n/).filter(c=>c.includes('-->'));assert(cues.every(c=>/^\d\. /m.test(c)));
});
test('GET scope validates embedded year before normalization; conflicting and missing years rejected',async()=>{
 const fs=require('node:fs'),{requireOrderYear,normalizeOrderWeek,resolveActiveOrderYear}=await import('../lib/orderUtils.js');
 const source=fs.readFileSync('pages/api/shipment/distribute.js','utf8');const start=source.indexOf('  let { type, week, year,');const end=source.indexOf('\n  try {',source.indexOf('    orderYear = resolveActiveOrderYear',start));
 const prefix=source.slice(start,end);const scope=new Function('req','res','useExeParityFlag','normalizeOrderWeek','requireOrderYear','resolveActiveOrderYear',prefix+';return {orderYear,week};');
 const run=query=>scope({query},{status(n){this.code=n;return this;},json(body){return {status:this.code,code:body.code};}},()=>true,normalizeOrderWeek,requireOrderYear,resolveActiveOrderYear);
 assert.deepEqual(run({week:'2026-45-01'}),{orderYear:'2026',week:'45-01'});assert.deepEqual(run({week:'45-01',year:'2025'}),{orderYear:'2025',week:'45-01'});
 assert.equal(run({week:'2026-45-01',year:'2025'}).status,400);assert.equal(run({week:'45-01'}).status,400);
});
test('major subtotal includes only real subweeks; distinct dates counted once; common whole units',async()=>{
 const {majorInlineDateModel}=await import('../lib/shipmentMajorInlineDates.js');const {dateQuantityUnits,dateDisplayQuantity}=await import('../lib/shipmentDateDisplayUnits.js');
 const input=[second,{...base,ShipmentQuantity:.4},{...base,Timestamp:calendar[4].Timestamp,ShipmentQuantity:.6}];const before=JSON.stringify(input);
 const m=majorInlineDateModel(calendar,input,'2026','2026-45-01',1,3513);assert.equal(m.error,'');assert.deepEqual(m.rows.map(r=>r.week),['45-01','45-02']);assert.equal(m.total,3);assert.equal(m.dayTotals[calendar[2].Timestamp],.4);assert.equal(m.dayTotals[calendar[3].Timestamp],2);
 const p=dateQuantityUnits(base,m.rows.flatMap(r=>[r.model.out,...r.model.dates.map(d=>d.ShipmentQuantity)]))[0];assert.equal(dateDisplayQuantity(m.total,p),'45');assert.equal(JSON.stringify(input),before);
});
test('explicit zero preserved, missing response is not zero, selected empty subweek not invented',async()=>{
 const {majorInlineDateModel}=await import('../lib/shipmentMajorInlineDates.js');
 const m=majorInlineDateModel(calendar,[base,{...second,OutQuantity:0,ShipmentQuantity:0}],'2026','45-03',1,3513);assert.equal(m.error,'');assert.equal(m.total,1);assert.equal(m.rows.length,2);assert.equal(m.rows[1].model.out,0);
 assert.equal(majorInlineDateModel(calendar,null,'2026','45-01',1,3513).total,null);
});
test('cross-year/week/customer/product, corrupt dates, duplicate details and missing metadata do not yield a grand total',async()=>{
 const {majorInlineDateModel}=await import('../lib/shipmentMajorInlineDates.js');
 for(const change of [{OrderYear:'2025'},{OrderWeek:'44-02'},{OrderWeek:'45-05'},{CustKey:2},{ProdKey:9},{OutQuantity:null},{ShipmentQuantity:null},{BunchOf1Box:16},{Timestamp:calendar[6].Timestamp,ShipmentQuantity:3}]){const m=majorInlineDateModel(calendar,[base,{...second,...change}],'2026','45-01',1,3513);assert(m.error);assert.equal(m.total,null);}
 for(const rows of [[base,{...base,SdetailKey:3}],[base,{...base,Timestamp:calendar[1].Timestamp,ShipmentQuantity:.5,OutQuantity:2}]])assert(majorInlineDateModel(calendar,rows,'2026','45-01',1,3513).error);
 assert(majorInlineDateModel(calendar.slice(1),[base],'2026','45-01',1,3513).error);
});
