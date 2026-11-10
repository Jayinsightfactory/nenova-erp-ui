const {test}=require('node:test'),assert=require('node:assert/strict'),c=require('../lib/shipmentStatement.cjs'),{buildWorkbook}=require('../lib/shipmentStatementWorkbook.cjs');
const raw=(overrides={})=>({OrderYear:'2026',OrderWeek:'45-01',CustKey:7,ProdKey:1,SdetailKey:11,OutQuantity:3,Cost:12000,OutUnit:'단',CounName:'콜롬비아',FlowerName:'장미',ProdName:'문라이트',...overrides});
const scope={year:'2026',week:45,custKey:7};
const rows=c.sourceRows([raw()],scope);
const dates=Array.from({length:7},(_,i)=>({WeekDay:new Date(Date.UTC(2026,10,4+i)).getUTCDay()+1,Date:new Date(Date.UTC(2026,10,4+i)).toISOString().slice(0,10)}));
test('explicit year, all subweeks, Master owner NULL-detail support, active positive scope',()=>{
 const r=c.sourceRows([raw(),raw({OrderWeek:'45-02',SdetailKey:12,OutQuantity:1,CustKey:7,DetailCustKey:null}),raw({OrderYear:'2025',OutQuantity:99}),raw({OrderWeek:'46-01'}),raw({CustKey:8}),raw({MasterDeleted:true}),raw({CustomerDeleted:true}),raw({ProductDeleted:true}),raw({OutQuantity:0}),raw({OutQuantity:-1})],scope);
 assert.equal(r.length,1);assert.equal(r[0].qty,4);assert.deepEqual(r[0].sources.map(s=>s.week),['45-01','45-02']);assert.throws(()=>c.scope({week:45}),/연도/);
});
test('3 initial; Wed1; Sat1; deletion; change default keeps explicit edits; zero supported',()=>{
 assert.equal(c.allocation(rows[0],{},'일').일,3);
 assert.deepEqual(c.allocation(rows[0],{수:1},'일'),{수:1,목:0,금:0,토:0,일:2,월:0,화:0});
 assert.equal(c.allocation(rows[0],{수:1,토:1},'일').일,1);
 assert.equal(c.allocation(rows[0],{토:1},'월').월,2);
 assert.equal(c.allocation(rows[0],{수:0},'일').일,3);
 assert.throws(()=>c.allocation(rows[0],{수:4},'일'),/초과/);assert.throws(()=>c.allocation(rows[0],{수:-1},'일'));assert.throws(()=>c.allocation(rows[0],{수:'NaN'},'일'));
 assert.throws(()=>c.preferences({defaultDay:'X'}));assert.equal(c.preferences({}).defaultDay,'일');assert.equal(c.BASE_DAYS[0],'수');
});
test('different price, unit, product ID never silently merge; no unit conversions',()=>{
 const r=c.sourceRows([raw(),raw({Cost:13000,SdetailKey:12}),raw({OutUnit:'박스',SdetailKey:13}),raw({ProdKey:2,SdetailKey:14}),raw({Cost:0,SdetailKey:15}),raw({Cost:null,SdetailKey:16})],scope);
 assert.equal(r.length,6);assert.equal(r.find(x=>x.cost===0).cost,0);assert.equal(r.find(x=>x.cost===null).cost,null);assert.ok(r.every(x=>x.qty===3));
});
test('bulk final-value replaces allocations of selected only; does not mutate source',()=>{
 const input={[rows[0].id]:{수:1}},before=JSON.stringify(rows),next=c.bulkMove(rows,input,[rows[0].id],'토');assert.deepEqual(next[rows[0].id],{토:3});assert.deepEqual(input[rows[0].id],{수:1});assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(c.bulkMove(rows,input,[],'화'),input);
});
test('real PeriodDay, invalid/duplicate calendar and stale row IDs rejected',()=>{
 assert.equal(c.calendar(dates)[0].date,'2026-11-04');assert.equal(c.calendar(dates)[6].day,'화');assert.throws(()=>c.calendar(dates.slice(1)));assert.throws(()=>c.calendar([...dates.slice(0,6),dates[0]]));assert.throws(()=>c.validatePlan(rows,{defaultDay:'일',entries:{unknown:{수:1}}}),/변경/);
});
test('category grouping, empty group names and duplicate memberships validated',()=>{
 const key=rows[0].category;assert.equal(c.preferences({groups:[{name:'콜수국·콜장미',categories:[key]}]}).groups[0].name,'콜수국·콜장미');assert.throws(()=>c.preferences({groups:[{name:'A',categories:[key]},{name:'B',categories:[key]}]}),/한 묶음/);
});
test('workbook day sheets, original quantity/price, every detail in subtotal; mixed units separated',()=>{
 const all=c.sourceRows([raw(),raw({ProdKey:2,SdetailKey:12,ProdName:'수국',FlowerName:'수국',OutUnit:'박스',OutQuantity:2})],scope);
 const record={source:{scope,customer:{name:'연습업체'},calendar:c.calendar(dates),rows:all},draft:{defaultDay:'일',groups:[{name:'콜수국·콜장미',categories:all.map(r=>r.category)}],entries:{[rows[0].id]:{수:1,토:1}}}};
 const wb=buildWorkbook(record);assert.deepEqual(wb.SheetNames,['수','토','일']);assert.match(wb.Sheets.수.A1.v,/2026-11-04/);assert.equal(wb.Sheets.수.C5.v,1);assert.equal(wb.Sheets.수.D5.v,12000);assert.equal(wb.Sheets.수.C6.f,'SUM(C5:C5)');assert.equal(wb.Sheets.일.C6.v+wb.Sheets.일.C10.v,3);assert.match(wb.Sheets.일.C4.v,/단|박스/);
});
