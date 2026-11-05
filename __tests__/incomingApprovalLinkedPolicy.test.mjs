import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApprovalMatching } from '../lib/incomingApprovalPolicy.js';
import {buildReceiptIdentityPlan,buildApprovalFarmPlan} from '../lib/incomingApprovalLinkedPolicy.js';
const row=(WdetailKey,ProdKey,OutQuantity)=>({WdetailKey,ProdKey,OutQuantity,OrderCode:'A'});
test('receipt identities preserve explicitly mapped product replacement and zero only historical unused rows',()=>{
  const plan={detailsChanged:true,before:[row(10,1,10),row(11,2,20)],after:[row(null,3,15)]};
  const match=normalizeApprovalMatching({rows:[],receiptMappings:[{sourceWdetailKey:10,targetRowIndex:0},{sourceWdetailKey:11,targetRowIndex:null}]});
  const actual=buildReceiptIdentityPlan(plan,match,{preserveReferenced:true});
  assert.equal(actual.targets[0].sourceWdetailKey,10);assert.deepEqual(actual.removed.map(r=>[r.row.WdetailKey,r.preserve]),[[11,true]]);assert.deepEqual(actual.issues,[]);
});
test('split mapping keeps one physical identity and explicitly creates second, unrelated receipt keys reject',()=>{
  const plan={detailsChanged:true,before:[row(10,1,10)],after:[row(null,2,6),row(null,3,4)]};
  const m=normalizeApprovalMatching({rows:[],receiptMappings:[{sourceWdetailKey:10,targetRowIndex:0},{sourceWdetailKey:10,targetRowIndex:1}]});
  assert.deepEqual(buildReceiptIdentityPlan(plan,m).targets.map(t=>t.sourceWdetailKey),[10,null]);
  m.receiptMappings[0].sourceWdetailKey=999;assert(buildReceiptIdentityPlan(plan,m).issues.some(i=>i.code==='APPROVAL_RECEIPT_SOURCE_INVALID'));
});
const facts={receiptPlan:{detailsChanged:true},details:[{SdetailKey:10,ShipmentKey:1,ProdKey:1,OutQuantity:10}],masters:[{ShipmentKey:1}],dates:[],farmAssignments:[{SfarmKey:20,SdetailKey:10,FarmKey:2,ShipmentQuantity:10}],farmCandidates:{1:[{FarmKey:2},{FarmKey:3}]}};
const group={key:'1:1',detail:facts.details[0],master:{ShipmentKey:1,CustName:'test'},product:{ProdKey:1,ProdName:'A'},outQuantity:6};
test('allocated reduction requires explicit final table; reduced-only and complete removal are supported',()=>{
  const m=normalizeApprovalMatching({rows:[]});assert(buildApprovalFarmPlan(facts,m,[group]).issues.some(i=>i.code==='APPROVAL_FARM_ALLOCATION_REVIEW'));
  m.farmGroups=[{shipmentKey:1,prodKey:1,assignments:[{farmKey:2,quantity:6}]}];assert.deepEqual(buildApprovalFarmPlan(facts,m,[group]).issues,[]);
  m.farmGroups[0].assignments=[];assert.deepEqual(buildApprovalFarmPlan(facts,m,[{...group,outQuantity:0}]).issues,[]);
});
test('farm over-allocation, wrong candidate and farm-only quantity changes fail',()=>{
  const m=normalizeApprovalMatching({rows:[],farmGroups:[{shipmentKey:1,prodKey:1,assignments:[{farmKey:9,quantity:8}]}]});
  const issues=buildApprovalFarmPlan(facts,m,[group]).issues;assert(issues.some(i=>i.code==='APPROVAL_FARM_TOTAL'));assert(issues.some(i=>i.code==='APPROVAL_FARM_CANDIDATE'));
  const f={...facts,receiptPlan:{detailsChanged:false}};m.farmGroups[0].assignments=[{farmKey:3,quantity:5},{farmKey:2,quantity:5}];assert(buildApprovalFarmPlan(f,m,[]).issues.some(i=>i.code==='APPROVAL_FARM_ONLY_QUANTITY'));
  m.farmGroups[0].assignments=[{farmKey:3,quantity:10}];assert.deepEqual(buildApprovalFarmPlan(f,m,[]).issues,[]);
});
test('matching zero values remain explicit and duplicate group/source pairs reject',()=>{
  assert.equal(normalizeApprovalMatching({rows:[],farmGroups:[{shipmentKey:1,prodKey:1,assignments:[{farmKey:2,quantity:0}]}]}).farmGroups[0].assignments[0].quantity,0);
  assert.throws(()=>normalizeApprovalMatching({rows:[],receiptMappings:[{sourceWdetailKey:1,targetRowIndex:0},{sourceWdetailKey:1,targetRowIndex:0}]}));
  assert.throws(()=>normalizeApprovalMatching({rows:[],farmGroups:[{shipmentKey:1,prodKey:1,assignments:[{farmKey:2,quantity:''}]}]}));
});
