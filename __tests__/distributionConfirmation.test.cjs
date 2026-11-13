const test=require('node:test'),assert=require('node:assert/strict');
const load=require('../scripts/load-isolated-erp-api.cjs');
test('real confirmation GET binds explicit year+subweek; previous year never merges, POST rejected',async()=>{
 let calls=0;const api=load('pages/api/shipment/distribution-confirmation.js',{sql:{NVarChar:'nvarchar'},query:async(s,p)=>{calls++;assert.match(s,/OrderYear=@year AND OrderWeek=@week/);assert.match(s,/DetailFix/);assert.doesNotMatch(s,/MasterFix|INSERT|UPDATE|DELETE/);return {recordset:[{category:p.year.value==='2025'?'지난해품종':'현재품종',detailCount:2,fixedCount:p.year.value==='2025'?2:0}]};}});
 const request=async(method,query)=>{let status=200,data;await api({method,query,user:{userId:'fixture'}},{status(n){status=n;return this},json(v){data=v;return this},setHeader(){}});return {status,data};};
 assert.equal((await request('GET',{week:'2025-46-01',year:'2025'})).data.rows[0].status,'FIXED');assert.equal((await request('GET',{week:'2026-46-01',year:'2026'})).data.rows[0].status,'UNFIXED');assert.equal(calls,2);
 assert.equal((await request('GET',{week:'2025-46-01',year:'2026'})).status,400);assert.equal((await request('POST',{})).status,405);assert.equal(calls,2);
});
