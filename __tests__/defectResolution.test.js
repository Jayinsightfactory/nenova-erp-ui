import assert from 'node:assert/strict';
import { defectSourcePeriodLabel, defectResolution, resolutionDuplicateGroups, resolutionReadyRows } from '../lib/defectResolution.js';
import { canEditManualCost, saveManualCost } from '../lib/salesDefectManualCost.js';

const base = { deductionKey:1,custKey:10,prodKey:20,quantity:10,sourceUnit:'단',orderYear:2026,orderWeek:'43',registrationEligible:true };
assert.equal(defectResolution(base).kind,'ready');
for (const [patch, kind] of [
  [{registrationEligibilityCode:'COST_MISSING',registrationEligible:false},'cost'],
  [{registrationEligibilityCode:'CUSTOMER_SALE_MISSING',registrationEligible:false},'defer'],
  [{registrationEligibilityCode:'AUTO_SOURCE_ESTIMATE_CONFLICT',registrationEligible:false},'existing'],
  [{prodKey:null},'match'],[{custKey:null},'match'],[{sourceFactReview:true},'source'],
  [{missingLinkedEstimate:true},'held'],[{rejectedAutoSource:true},'source'],[{incompleteAutoSource:true},'source'],
  [{permanentOmitted:true},'omitted'],[{sourceUnitReview:true},'unit'],
]) assert.equal(defectResolution({...base,...patch}).kind,kind);
const row = (key,patch={}) => ({...base,deductionKey:key,editQuantity:10,after:{ShipmentKey:70,ProdKey:20,AppliedOrderYear:2026,AppliedOrderWeek:'44',Unit:'단'},...patch});
const rows=[row(1),row(2),row(3,{quantity:11,editQuantity:11}),row(4,{error:'단가 없음',after:null})];
assert.equal(resolutionDuplicateGroups(rows).length,1);
assert.deepEqual(resolutionReadyRows(rows).map(r=>r.deductionKey),[3], 'both unresolved candidates withheld; different quantity allowed');
assert.deepEqual(resolutionReadyRows(rows,new Set([2])).map(r=>r.deductionKey),[1,3]);
for(const patch of [{AppliedOrderYear:2025},{AppliedOrderWeek:'45'},{ProdKey:21},{ShipmentKey:71},{Unit:'박스'}]) {
  assert.equal(resolutionDuplicateGroups([row(1),row(2,{after:{...row(1).after,...patch}})]).length,0);
}
assert.equal(resolutionReadyRows([row(1,{editQuantity:0})]).length,0);

const stored={DeductionKey:1,OrderYear:2026,OrderWeek:'43',CustKey:10,ProdKey:20,Quantity:10,SourceUnit:'단',RowVersionNo:3,Status:'DRAFT',AutoSourceExcluded:1,AutoSourceEvidence:'KAKAO_SOURCE'};
assert.equal(canEditManualCost(stored),true, 'normal automatic source can supply missing price');
for(const patch of [{RejectedAutoSource:true},{SourceFactReview:true},{MissingLinkedEstimate:true},{IncompleteAutoSource:true},{PermanentOmitted:true},{SourceUnitReview:true},{EstimateKey:40},{Status:'COMPLETED'}]) assert.equal(canEditManualCost({...stored,...patch}),false);
const writes=[];
const tx=async callback=>callback(async(statement,params)=>{
  if(/SELECT d\.\*/.test(statement))return {recordset:[stored]};
  if(/FROM Product WHERE/.test(statement))return {recordset:[{EstUnit:'단',OutUnit:'단'}]};
  if(/SELECT/.test(statement)&&/WebSalesDefectDeductionHistory/.test(statement))return {recordset:[]};
  if(/UPDATE WebSalesDefectDeduction SET/.test(statement)){writes.push('version');return {rowsAffected:[1]};}
  if(/INSERT INTO WebSalesDefectDeductionHistory/.test(statement)){writes.push('audit');return {rowsAffected:[1]};}
  throw Error('unexpected query: '+statement);
});
await saveManualCost({year:2026,week:44,deductionKey:1,cost:'12500',expectedRowVersionNo:3,expectedEstimateUnit:'단',custKey:10,prodKey:20,user:{userId:'test'}},tx);
assert.deepEqual(writes,['version','audit']);
for(const patch of [{year:2025},{week:42},{expectedRowVersionNo:2},{custKey:11},{prodKey:21},{expectedEstimateUnit:'박스'},{cost:0},{cost:false}]) {
  const before=writes.length;
  await assert.rejects(saveManualCost({year:2026,week:44,deductionKey:1,cost:12500,expectedRowVersionNo:3,expectedEstimateUnit:'단',custKey:10,prodKey:20,...patch},tx));
  assert.equal(writes.length,before);
}
console.log('resolution: actionable issues, whole duplicate group hold, different quantity/year/unit, audited auto-source price and stale/scope no-write guards PASS');

// Original identity survives target-week, price-week and cross-year differences.
assert.equal(defectSourcePeriodLabel({orderYear:2026,orderWeek:'42',appliedOrderWeek:'44',distributionCostOrderWeek:'43-01'}),'2026년 42차 불량');
assert.equal(defectSourcePeriodLabel({orderYear:2025,orderWeek:'42'}),'2025년 42차 불량');
assert.equal(defectSourcePeriodLabel({orderYear:2026,orderWeek:'42-02'}),'2026년 42-02차 불량');
for (const row of [{}, {orderYear:2026}, {orderWeek:'42'}, {orderYear:2026,orderWeek:0}, {orderYear:2026,orderWeek:'bad'}]) assert.equal(defectSourcePeriodLabel(row),'원불량 차수 미확인');
