import assert from 'node:assert/strict';
import { defectCostScope, defectRecentCostSql, costLookupKeyword, costProductMatchesSearch } from '../lib/defectCostCandidates.js';
import { loadDefectCostCandidates, resolveEstimateContext } from '../lib/salesDefectDeductions.js';
import { isDefectRegistrationHeld, defectResolution } from '../lib/defectResolution.js';
import { evaluateDefectRegistrationEligibility } from '../lib/defectEstimateTargetScope.js';
import { supportRegistrationDecisionLabel } from '../lib/salesDefectSupportStatus.js';

assert.deepEqual(defectCostScope(2026,44),{year:2026,minWeek:39,maxWeek:43});
assert.deepEqual(defectCostScope(2026,1),{year:2026,minWeek:1,maxWeek:0});
assert.deepEqual(defectCostScope(2025,44),{year:2025,minWeek:39,maxWeek:43});
for(const value of [undefined,0,false,'no'])assert.throws(()=>defectCostScope(value,44));
assert.equal(costLookupKeyword('SPRAY ROSE CHINA / 오션송 ( Ocean Song) '),'오션송');
assert.equal(costLookupKeyword('ROSE CHINA / 그로우 (Water Sprite)'),'그로우');
assert.equal(defectRecentCostSql(5).replace('TOP 5','TOP 1'),defectRecentCostSql());
assert.throws(()=>defectRecentCostSql(500));
const calls=[];
const query=async(statement,params)=>{
 assert.match(statement,/^SELECT/);calls.push({statement,params});
 if(statement.includes('AS CostSource')) {
  assert.equal(params.scopeYear.value,2026);assert.equal(params.minWeek.value,39);assert.equal(params.scopeWeek.value,43);
  assert.equal(params.ck.value,565);
  return {recordset:params.pk.value===2085?[{Cost:6500,SourceCustKey:565,SourceCustName:'태림',SourceOrderYear:2026,SourceOrderWeek:'43-01',SourceShipmentKey:99}]:[]};
 }
 return {recordset:[{ProdKey:2473,ProdName:'SPRAY ROSE CHINA / 오션송 (Ocean Song)',EstUnit:'단'}]};
};
const result=await loadDefectCostCandidates({year:2026,week:44,custKey:565,prodKey:2473},query,async({q})=>{
 assert.equal(q,'오션송');return {products:[{ProdKey:2085,ProdName:'ROSE CHINA / 오션송',EstUnit:'단'},{ProdKey:2473,ProdName:'SPRAY ROSE CHINA / 오션송',EstUnit:'단'}]};
});
assert.equal(result.products.length,2);assert.equal(result.products[0].current,true);assert.equal(result.products[0].costs.length,0);
assert.equal(result.products[1].current,false);assert.equal(result.products[1].costs[0].cost,6500);
assert.equal(result.products[1].costs[0].customerName,'태림');
assert.equal(calls.filter(x=>x.statement.includes('AS CostSource')).length,2);
await assert.rejects(loadDefectCostCandidates({year:2026,week:44,custKey:565,prodKey:0},query));
await assert.rejects(resolveEstimateContext({year:2026,week:44,custKey:565,prodKey:2473},async text=>{
 if(text.includes('AS CostSource'))throw Error('timeout');return {recordset:[]};
}),e=>e.code==='COST_LOOKUP_FAILED');
assert.equal(evaluateDefectRegistrationEligibility({context:{lookupError:'COST_LOOKUP_FAILED'}}).code,'COST_LOOKUP_FAILED');
for(const r of [{missingLinkedEstimate:true,estimateKey:10499},{sourceFactReview:true},{custKey:565,prodKey:3389,registrationEligibilityCode:'CUSTOMER_SALE_MISSING'}])assert.equal(isDefectRegistrationHeld(r),true);
for(const r of [{registrationEligibilityCode:'COST_MISSING'},{custKey:565,prodKey:null,registrationEligibilityCode:'CUSTOMER_SALE_MISSING'},{registrationEligible:true}])assert.equal(isDefectRegistrationHeld(r),false);
const held={missingLinkedEstimate:true,estimateKey:10499};
assert.equal(defectResolution(held).kind,'match'); // invalid identity remains identifiable, but still held
assert.match(supportRegistrationDecisionLabel(held),/보류.*이전 차감 견적/);
assert.equal(evaluateDefectRegistrationEligibility({row:held,context:{shipmentKey:7,cost:7900}}).eligible,false,'distribution never recreates deleted deduction');
console.log('cost references: separate product identity, customer/week metadata, no writes, query failure, held separation PASS');

assert.equal(costProductMatchesSearch({ProdName:'CARNATION Moon Light'},'그로우'),false);
assert.equal(costProductMatchesSearch({ProdName:'ROSE CHINA / 그로우 (Water Sprite) 75-80cm'},'그로우'),true);
