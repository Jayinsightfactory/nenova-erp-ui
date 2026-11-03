import assert from 'node:assert/strict';
import {resolveEstimateContext} from '../lib/salesDefectDeductions.js';
import {evaluateDefectRegistrationEligibility} from '../lib/defectEstimateTargetScope.js';
for(const [year,week,min,max] of [[2026,44,39,43],[2026,3,1,2],[2026,1,1,0],[2025,44,39,43]]) {
 let seen=false;
 const context=await resolveEstimateContext({year,week,custKey:7,prodKey:9},async(text,params)=>{
 if(text.includes('AS CostSource')) {
 seen=true;
 assert.equal(params.scopeYear.value,year);assert.equal(params.minWeek.value,min);assert.equal(params.scopeWeek.value,max);
 assert.match(text,/sm.OrderYear=@scopeYear/);assert.match(text,/BETWEEN @minWeek AND @scopeWeek/);
 assert.match(text,/CASE WHEN sm.CustKey=@ck THEN 0 ELSE 1 END/);
 assert.doesNotMatch(text,/WHERE sm.CustKey=@ck/);
 return {recordset:[{Cost:2500,SourceOrderYear:year,SourceOrderWeek:String(max)}]};
 }
 if(text.includes('FROM Product'))return {recordset:[{EstUnit:'송이'}]};
 return {recordset:[]};
 });
 assert.ok(seen);assert.equal(context.shipmentKey,null);
 assert.equal(evaluateDefectRegistrationEligibility({context,row:{}}).code,'CUSTOMER_SALE_MISSING');
 assert.equal(evaluateDefectRegistrationEligibility({context:{...context,shipmentKey:3},row:{}}).eligible,true);
}
console.log('recent 5-week bounds, year boundaries, customer fallback and target distribution hold passed');
