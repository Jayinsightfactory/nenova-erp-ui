const test=require('node:test'),assert=require('node:assert/strict');
test('distribution compare-and-set permits unchanged row, rejects concurrent quantity/cost and malformed baseline',async()=>{
 const {assertDistributionExpected:check}=await import('../lib/distributionConcurrentEdit.js');
 check({outQty:2,cost:100},{OutQuantity:2,Cost:100});check({outQty:0,cost:100},null);
 for(const expected of [null,{}, {outQty:'2',cost:100},{outQty:2,cost:NaN},{outQty:-1,cost:1}])assert.throws(()=>check(expected,null),{code:'DISTRIBUTION_BASELINE_REQUIRED'});
 assert.throws(()=>check({outQty:2,cost:100},{OutQuantity:3,Cost:100}),{code:'DISTRIBUTION_STALE'});
 assert.throws(()=>check({outQty:2,cost:100},{OutQuantity:2,Cost:110}),{code:'DISTRIBUTION_STALE'});
 assert.throws(()=>check({outQty:2,cost:100},null),{code:'DISTRIBUTION_STALE'});
});
