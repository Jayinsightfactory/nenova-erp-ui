import assert from 'node:assert/strict';
import { defectSourceReview } from '../lib/salesDefectAutoSource.js';
import { evaluateDefectRegistrationEligibility } from '../lib/defectEstimateTargetScope.js';
import { deriveSupportProcessingStatus, isSupportProcessingComplete, isSupportManualCompleteSelectable, supportRegistrationDecisionLabel } from '../lib/salesDefectSupportStatus.js';
import { preflightRegistration, registrationPreview, registerDeductions } from '../lib/salesDefectDeductions.js';
for (const [key, flag, code] of [[722,'RejectedAutoSource','REJECTED_AUTO_SOURCE'],[740,'RejectedAutoSource','REJECTED_AUTO_SOURCE'],[859,'MissingLinkedEstimate','LINKED_ESTIMATE_MISSING'],[868,'MissingLinkedEstimate','LINKED_ESTIMATE_MISSING'],[877,'MissingLinkedEstimate','LINKED_ESTIMATE_MISSING'],[1054,'IncompleteAutoSource','SOURCE_EVIDENCE_INCOMPLETE'],[1527,'SourceUnitReview','SOURCE_UNIT_CONVERSION_REQUIRED'],[1066,'SourceFactReview','SOURCE_FACT_REVIEW_REQUIRED']]) {
  const row={DeductionKey:key,OrderYear:2026,OrderWeek:'40',CustKey:533,ProdKey:889,Quantity:1,SourceUnit:'송이',Status:'REGISTERED',EstimateKey:10802,[flag]:true};
  const ui={...row,deductionKey:key,status:'REGISTERED',estimateKey:10802,processingStatus:'REGISTERED',rejectedAutoSource:flag==='RejectedAutoSource',missingLinkedEstimate:flag==='MissingLinkedEstimate'};
  assert.equal(defectSourceReview(row).code,code);
  assert.equal(evaluateDefectRegistrationEligibility({row:ui,context:{shipmentKey:6852,cost:2400}}).code,code);
  assert.equal(deriveSupportProcessingStatus(ui).processingStatus,'SOURCE_REVIEW');
  assert.equal(isSupportProcessingComplete(ui),false);
  assert.equal(isSupportManualCompleteSelectable(ui),false);
  assert.equal(supportRegistrationDecisionLabel(ui),'확인 필요 · 등록 제외');
  let writes=0;
  const query=async(sql)=>{
    if (/\b(INSERT|UPDATE|DELETE)\s+(INTO|Estimate|WebSales)/i.test(sql)) writes++;
    if (/CodeInfo/.test(sql)) return {recordset:[{DetailCode:'FEE03-KR0010'}]};
    if (/FROM WebSalesDefectDeduction d/.test(sql)) return {recordset:[row]};
    if (/FROM Estimate|FROM Product/.test(sql)) return {recordset:[]};
    throw new Error('Unexpected reconciliation query');
  };
  for(const targetWeek of [43,44,45,53]) {
  const preflight=await preflightRegistration({year:2026,week:targetWeek,rows:[{deductionKey:key,RejectedAutoSource:false,MissingLinkedEstimate:false}]},query);
  assert.equal(preflight[0].errorCode,code,'client flags cannot bypass authoritative stored review state');
  const preview=await registrationPreview({year:2026,week:targetWeek,ids:[key]},query);
  assert.equal(preview[0].errorCode,code);
  const result=await registerDeductions({year:2026,week:targetWeek,ids:[key],user:{userId:'test'}},{ensureTables:async()=>{},withTransaction:async(fn)=>fn(query)});
  assert.equal(result.registered.length,0);
  assert.equal(result.skipped[0].errorCode,code);
  assert.equal(writes,0);
  }
}
console.log('source reconciliation: five incident fixtures, authoritative preflight/preview/register, stale completion and zero writes passed');
