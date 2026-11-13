const test=require('node:test'),assert=require('node:assert/strict');
const load=require('../scripts/load-isolated-erp-api.cjs');
test('real confirmation GET binds explicit year+subweek; previous year never merges, POST rejected',async()=>{
 let calls=0;const api=load('pages/api/shipment/distribution-confirmation.js',{sql:{NVarChar:'nvarchar'},query:async(s,p)=>{calls++;assert.match(s,/OrderYear=@year AND OrderWeek=@week/);assert.match(s,/DetailFix/);assert.doesNotMatch(s,/MasterFix|INSERT|UPDATE|DELETE/);return {recordset:[{category:p.year.value==='2025'?'지난해품종':'현재품종',detailCount:2,fixedCount:p.year.value==='2025'?2:0}]};}});
 const request=async(method,query)=>{let status=200,data;await api({method,query,user:{userId:'fixture'}},{status(n){status=n;return this},json(v){data=v;return this},setHeader(){}});return {status,data};};
 assert.equal((await request('GET',{week:'2025-46-01',year:'2025'})).data.rows[0].status,'FIXED');assert.equal((await request('GET',{week:'2026-46-01',year:'2026'})).data.rows[0].status,'UNFIXED');assert.equal(calls,2);
 assert.equal((await request('GET',{week:'2025-46-01',year:'2026'})).status,400);assert.equal((await request('POST',{})).status,405);assert.equal(calls,2);
});
test('native category selection is parameterized; Netherlands family resolves to Netherlands, invalid selector fails closed',async()=>{
 const {loadDistributionConfirmationScope:scope}=await import('../lib/distributionConfirmationSummary.js');
 const sql={NVarChar:'n',Int:'i'},year={orderYear:'2026',orderWeek:'46-01'};let params,statement;
 const q=async(s,p)=>{statement=s;params=p;return {recordset:[{category:'네덜란드'}]}};
 assert.deepEqual(await scope(q,sql,year,{prodGroup:'네덜란드::장미',prodKey:null}),['네덜란드']);
 assert.match(statement,/p.CounName=@country AND p.FlowerName=@flower/);assert.match(statement,/vs.OrderYear=@year AND vs.OrderWeek=@week/);assert.equal(params.year.value,'2026');
 await scope(q,sql,year,{prodGroup:'네덜란드::',prodKey:null});assert.equal(params.flower,undefined);assert.equal(params.country.value,'네덜란드');
 await scope(q,sql,year,{prodGroup:'',prodKey:123});assert.equal(params.prodKey.value,123);assert.match(statement,/p.ProdKey=@prodKey/);
 for(const selection of [null,{},[],{prodGroup:'::장미'},{prodGroup:'',prodKey:0}])await assert.rejects(()=>scope(q,sql,year,selection));
});
