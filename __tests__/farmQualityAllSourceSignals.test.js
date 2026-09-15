import assert from 'node:assert/strict';
import {qualityScope,qualitySignals,qualitySignalCoverage,qualityGroups,qualityAnalytics} from '../lib/farmQuality.js';
const scope=qualityScope({year:2026,from:10,to:20});
const row=(key,week,extra={})=>({DeductionKey:key,OrderYear:2026,OrderWeek:String(week),ProdKey:1,ProductName:'장미',FarmName:'농장 A',SourceUnit:'박스',Quantity:2,ImportConfirmed:true,CustKey:901001,CustName:'업체 A',...extra});
const trusted=[row(1,10),row(2,11),row(3,11,{CustKey:901002}),row(4,11,{ProdKey:2}),row(5,12,{ProdKey:2})];
const baseline=qualitySignals(trusted,scope);
assert.deepEqual(new Set(baseline.map(s=>s.kind)),new Set(['SAME_ITEM_WEEK','FARM_WEEK_CLUSTER','ITEM_PERSISTENT','FARM_RECURRING']));
assert(baseline.every(s=>s.canCreate&&!s.reviewRequired&&s.sourceKey&&s.attribution==='FARM'));
const additional=[row(6,11,{ImportConfirmed:false}),row(7,10,{FarmName:''}),row(8,10,{FarmName:'',CustKey:901002}),row(9,11,{FarmName:''})];
const all=[...trusted,...additional];
const before=structuredClone(all),signals=qualitySignals(all,scope);
assert.deepEqual(all,before);
const weekly=signals.find(s=>s.kind==='UNASSIGNED_ITEM_WEEK');
assert.deepEqual(weekly.sourceKeys,[7,8]);assert.equal(weekly.attribution,'PRODUCT');
const persistent=signals.find(s=>s.kind==='UNASSIGNED_ITEM_PERSISTENT');
assert.deepEqual(persistent.sourceKeys,[7,9]);assert.equal(persistent.attribution,'CUSTOMER_PRODUCT');
assert(signals.filter(s=>s.sourceKeys.some(k=>k>=6)).every(s=>s.reviewRequired&&!s.canCreate&&s.sourceKey===null&&s.reviewReasons.length));
assert(signals.filter(s=>s.attribution==='FARM').every(s=>s.sourceKeys.every(k=>k<7)));
assert.deepEqual(qualityGroups(all,scope).groups,qualityGroups(trusted,scope).groups);
assert.deepEqual(qualityAnalytics(qualityGroups(all,scope).groups,[],scope),qualityAnalytics(qualityGroups(trusted,scope).groups,[],scope));
const coverage=qualitySignalCoverage(all,scope,signals);
assert.equal(coverage.analyzedSourceCount,9);assert.equal(coverage.confirmedSourceCount,5);assert.equal(coverage.additionalSourceCount,4);
assert.equal(coverage.detectedSourceCount,9);assert.equal(coverage.noPatternSourceCount,0);
assert.equal(coverage.totalSignalCount,signals.length);assert.equal(coverage.reviewSignalCount,signals.filter(s=>s.reviewRequired).length);
assert( signals.reduce((n,s)=>n+s.sourceCount,0)>coverage.detectedSourceCount);
const serialized=JSON.stringify(signals);
for(const privateValue of ['CustKey','customerIdentity','901001','901002'])assert(!serialized.includes(privateValue));
assert.equal(qualitySignals([...all].reverse(),scope).find(s=>s.kind==='UNASSIGNED_ITEM_PERSISTENT').key,persistent.key);

const edge=[row(20,10,{OrderYear:2025}),row('20',10),row(20,10),row(21,10,{IsDeleted:true}),row(22,10,{OriginalQuantity:0,Quantity:9}),row(23,10,{Quantity:NaN}),row(24,10,{ProdKey:0}),row(0,10),row(25,'unknown'),row(26,30),row(27,10,{Quantity:null})];
const edgeCoverage=qualitySignalCoverage(edge,scope);
assert.equal(edgeCoverage.analyzedSourceCount,1);assert.equal(edgeCoverage.invalidSourceCount,5);assert.equal(edgeCoverage.invalidWeekCount,1);assert.equal(edgeCoverage.noPatternSourceCount,1);
const missing=(key,week,extra={})=>row(key,week,{FarmName:'',...extra});
for(const nearMiss of [
 [missing(30,10),missing(31,11,{CustKey:901002})],
 [missing(30,10),missing(31,11,{SourceUnit:'송이'})],
 [missing(30,10,{CustKey:null}),missing(31,11,{CustKey:null})],
 [missing(30,10),missing(31,14)],
 [missing(30,10),missing(31,10)],
])assert.equal(qualitySignals(nearMiss,scope).length,0);
assert(qualitySignals([missing(30,10),missing(31,12),missing(32,13)],scope).some(s=>s.kind==='UNASSIGNED_ITEM_PERSISTENT'));
console.log('All-source signals: review gating, attribution, coverage conservation and trusted analysis preservation passed');
