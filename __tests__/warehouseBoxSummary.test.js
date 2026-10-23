const test=require('node:test'),assert=require('node:assert/strict');
const {filterBoxSummary,boxSummaryTotals,boxSummaryYear,WAREHOUSE_BOX_SQL}=require('../lib/warehouseBoxSummary.js');
test('same week other year excluded; stored decimals, zero and missing distinguished',()=>{
 const rows=[{OrderYear:'2025',OrderWeek:'42-01',country:'중국',flower:'수국',boxes:999},
 {OrderYear:'2026',OrderWeek:'42-01',country:'중국',flower:'수국',boxes:1.5,lineCount:2,missingBoxes:0},
 {OrderYear:'2026',OrderWeek:'42-01',country:'중국',flower:'장미',boxes:0,lineCount:1,missingBoxes:0},
 {OrderYear:'2026',OrderWeek:'42-02',country:'미분류',flower:'미분류',boxes:null,lineCount:1,missingBoxes:1}];
 assert.deepEqual(boxSummaryTotals(filterBoxSummary(rows,{year:'2026'})),{boxes:1.5,lineCount:4,missingBoxes:1});
 assert.equal(filterBoxSummary(rows,{year:'2026',week:'42-01',country:'중국',flower:'장미'})[0].boxes,0);
 assert.equal(filterBoxSummary(rows,{year:'2026',country:'콜롬비아'}).length,0);
 for(const value of [undefined,'','0','2026 OR 1=1',false])assert.throws(()=>boxSummaryYear(value));
 assert.match(WAREHOUSE_BOX_SQL,/wm.OrderYear>=@year AND wm.OrderYear<=@toYear/);assert.doesNotMatch(WAREHOUSE_BOX_SQL,/JOIN (?:Farm|Order)|p.isDeleted|wd.isDeleted|SteamOf1Box|\b(?:INSERT|UPDATE|DELETE)\b/i);
});

const {summarizeReceipts,boxSummaryRange}=require('../lib/warehouseBoxSummary.js');
const {createBoxSummaryHandler}=require('../lib/warehouseBoxSummary.js');
test('actual API handler validates range, preserves zero/null, rejects writes and masks SQL errors',async()=>{
 const calls=[];let fail=false;
 const handler=createBoxSummaryHandler({types:{NVarChar:'nvarchar'},queryFn:async(s,p)=>{calls.push({s,p});if(fail)throw Error('secret SQL credentials');return {recordset:[{boxes:0,gw:null,cw:0}]};}});
 const res=()=>({status(n){this.code=n;return this;},json(v){this.body=v;return this;},setHeader(k,v){this[k]=v;}});
 for(const query of [{},{year:''},{year:false},{year:['2026']},{year:'2026',toYear:'2025'},{year:'2026',toYear:'2036'}]){const r=res();await handler({method:'GET',query},r);assert.equal(r.code,400);}
 const post=res();await handler({method:'POST',query:{year:'2026'}},post);assert.equal(post.code,405);assert.equal(calls.length,0);
 const good=res();await handler({method:'GET',query:{year:'2026'}},good);assert.equal(good.code,200);assert.equal(calls[0].p.toYear.value,'2026');assert.deepEqual(good.body.rows,[{boxes:0,gw:null,cw:0}]);assert.equal(good['Cache-Control'],'private, no-store');
 const range=res();await handler({method:'GET',query:{year:'2025',toYear:'2026'}},range);assert.equal(calls[1].p.year.value,'2025');assert.equal(calls[1].p.toYear.value,'2026');
 fail=true;const failed=res();await handler({method:'GET',query:{year:'2026'}},failed);assert.equal(failed.code,500);assert.doesNotMatch(JSON.stringify(failed.body),/secret|credentials|SQL/);
});
const base={OrderYear:'2026',OrderWeek:'42-01',inputDate:'2026-10-13',country:'중국',flower:'수국',boxes:2,lineCount:1,missingBoxes:0,gw:100,cw:120};
const fixtures=[{...base,WarehouseKey:1},{...base,WarehouseKey:1,flower:'장미',boxes:3},
 {...base,WarehouseKey:2,boxes:1.5,inputDate:'2026-09-30',gw:50,cw:60},
 {...base,WarehouseKey:3,boxes:0,gw:0,cw:0},
 {...base,WarehouseKey:4,boxes:null,missingBoxes:1,gw:null,cw:null,country:'미분류',flower:'미분류',inputDate:null},
 {...base,WarehouseKey:5,OrderYear:'2025',inputDate:'2025-10-13',boxes:999,gw:999,cw:999}];
test('grouped boxes reconcile; mixed receipt weight is not duplicated or reassigned by filters',()=>{
 const s=summarizeReceipts(fixtures,{year:'2026'});
 assert.equal(s.totals.boxes,6.5);assert.equal(s.totals.receiptCount,4);
 assert.equal(s.totals.gw,50);assert.equal(s.totals.cw,60);assert.equal(s.totals.mixedGW,100);assert.equal(s.mixed.length,1);
 assert.equal(s.totals.missingBoxes,1);assert.equal(s.totals.missingGW,1);
 const filtered=summarizeReceipts(fixtures,{year:'2026',flower:'장미'});
 assert.equal(filtered.totals.boxes,3);assert.equal(filtered.totals.gw,null);
 assert.equal(filtered.mixed[0].gw,100);assert.equal(filtered.mixed[0].partial,true);
 const countries=summarizeReceipts(fixtures,{year:'2026',dimension:'country'});
 assert.equal(countries.totals.gw,150);assert.equal(countries.mixed.length,0);
 assert.equal(summarizeReceipts(fixtures,{year:'2026',dimension:'country',flower:'장미'}).totals.gw,null);
});
test('month uses InputDate, year and repeated subweeks remain isolated, explicit zero preserved',()=>{
 const s=summarizeReceipts(fixtures,{year:'2025',toYear:'2026',period:'month'});
 assert(s.rows.some(r=>r.period==='2025-10'));assert(s.rows.some(r=>r.period==='2026-09'));assert(s.rows.some(r=>r.period==='입고일 미기재'));
 const yearly=summarizeReceipts(fixtures,{year:'2025',toYear:'2026',period:'year',dimension:'country'});
 assert.equal(yearly.rows.find(r=>r.period==='2025').boxes,999);
 assert.equal(yearly.rows.find(r=>r.period==='2026'&&r.country==='중국').boxes,6.5);
 assert.equal(summarizeReceipts(fixtures,{year:'2026',month:'2026-09'}).totals.boxes,1.5);
 const zero=summarizeReceipts([fixtures[3]],{year:'2026'});assert.equal(zero.totals.gw,0);assert.equal(zero.rows[0].boxes,0);
 assert.equal(summarizeReceipts(fixtures,{year:'2026',country:'없는국가'}).rows.length,0);
 for(const args of [['2026','2025'],['2026','2036'],['2026',''],['2026',false]])assert.throws(()=>boxSummaryRange(...args));
 assert.deepEqual(boxSummaryRange('2026'),{year:'2026',toYear:'2026'});
});
test('equal weights on separate receipts add; same receipt duplicate groups do not',()=>{
 const rows=[{...base,WarehouseKey:1},{...base,WarehouseKey:1,boxes:3},{...base,WarehouseKey:2}];
 const s=summarizeReceipts(rows,{year:'2026'});assert.equal(s.totals.boxes,7);assert.equal(s.totals.gw,200);assert.equal(s.totals.cw,240);assert.equal(s.totals.receiptCount,2);
});
