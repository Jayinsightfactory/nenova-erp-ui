import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import {receiptItem,resizeReceiptItem,newReceiptItemQuantities,prepareSimpleMatching,prepareSimpleReview} from '../lib/incomingApprovalSimple.js';
import {normalizedCorrection,buildCorrectionPlan} from '../lib/warehouseCorrectionPolicy.js';
import {normalizeApprovalMatching,approvalPermissions,approvalError} from '../lib/incomingApprovalPolicy.js';
import {suggestReceiptMappings} from '../lib/incomingApprovalLinkedPolicy.js';

const products=[{ProdKey:1,ProdName:'A',OutUnit:'단',EstUnit:'송이',isDeleted:false},{ProdKey:2,ProdName:'B',OutUnit:'박스',EstUnit:'송이',isDeleted:false}];
const before=[{WdetailKey:11,ProdKey:1,OrderCode:'A',BoxQuantity:10,BunchQuantity:100,SteamQuantity:1000,SteamOf1Box:100,SteamOf1Bunch:10,OutQuantity:100,EstQuantity:1000,UPrice:1,TPrice:100}];
const header={WarehouseKey:90,OrderYear:'2026',OrderWeek:'41-01',FarmName:'Farm A',isDeleted:false};
const scope={warehouseKey:90,orderYear:'2026',orderWeek:'41-01'};
const correction=(kind='QUANTITY',patch={})=>({...scope,mode:'REPLACE',editKind:kind,farmName:'Farm A',fileName:'direct',fileMeta:{},items:[receiptItem(before[0],products)],...patch});
const plan=input=>buildCorrectionPlan(normalizedCorrection(input),header,before,products);

test('direct edit preserves row identity across product change and exact native units; zero cancels within receipt',()=>{
  const item=resizeReceiptItem(receiptItem(before[0],products),80,'단');
  assert.equal(item.steamQty,800);assert.equal(item.totalPrice,80);
  const p=plan(correction('QUANTITY',{items:[item]}));assert.equal(p.after[0].OutQuantity,80);assert.equal(p.after[0].EstQuantity,800);
  const changed=plan(correction('PRODUCT',{items:[{...item,prodName:'B'}]}));assert.equal(changed.after[0].OutQuantity,8);assert.deepEqual(suggestReceiptMappings(changed),[{sourceWdetailKey:11,targetRowIndex:0}]);
  const zero=plan(correction('CANCEL',{items:[resizeReceiptItem(receiptItem(before[0],products),0,'단')]}));assert.equal(zero.after.length,1);assert.equal(zero.after[0].OutQuantity,0);
});
test('new rows calculate only evidenced master packaging and reuse only unique current same-product purchase evidence',()=>{
 const p={...products[1],OutUnit:'단',SteamOf1Box:100,SteamOf1Bunch:10,BunchOf1Box:10};
 const blank={sourceWdetailKey:null,prodName:'B',unitPrice:'',totalPrice:''};
 const row=newReceiptItemQuantities(blank,20,p,before);assert.equal(row.boxQty,2);assert.equal(row.bunchQty,20);assert.equal(row.steamQty,200);assert.equal(row.unitPrice,'');
 const known=newReceiptItemQuantities({...blank,prodName:'A'},20,{...p,...products[0]},before);assert.equal(known.totalPrice,20);assert.equal(known.unitPrice,1);assert.equal(known.sourceWdetailKey,null);
 const missing=newReceiptItemQuantities(blank,20,{...products[1],OutUnit:'단'},[]);assert.equal(missing.boxQty,'');assert.equal(missing.steamQty,'');
});

test('scope tampering, missing/foreign/repeated rows, price or product changes in quantity mode are rejected',()=>{
  for(const patch of [{farmName:'Other'},{items:[{...receiptItem(before[0],products),sourceWdetailKey:999}]},{items:[{...receiptItem(before[0],products),sourceWdetailKey:null}]},{items:[receiptItem(before[0],products),receiptItem(before[0],products)]},{items:[{...receiptItem(before[0],products),unitPrice:2}]},{items:[{...receiptItem(before[0],products),totalPrice:99}]},{items:[{...receiptItem(before[0],products),boxQty:9}]},{items:[{...receiptItem(before[0],products),prodName:'B'}]}])assert.throws(()=>plan(correction('QUANTITY',patch)));
  assert.throws(()=>plan({...correction(),orderYear:'2027'}));
  assert.throws(()=>resizeReceiptItem({...receiptItem(before[0],products),bunchQty:0},10,'단'));
  assert.equal(plan(correction('ADD',{items:[receiptItem(before[0],products),{...receiptItem(before[0],products),sourceWdetailKey:null,prodName:'B'}]})).after.length,2);
});
test('automatic review scales only exact single-source same-product evidence; preserves support work and no stock/farm consent',()=>{
  const receiptPlan=plan(correction('QUANTITY',{items:[resizeReceiptItem(receiptItem(before[0],products),80,'단')]}));
  const facts={receiptPlan,receiptMappingSuggestions:suggestReceiptMappings(receiptPlan),costInputSuggestions:[{kind:'INVOICE',lineMappings:[{targetRowIndex:0,quantity:100,quantityUnit:'BUNCH'}]}]};
  const request={reason:'수량 정정',matching:{rows:[],farms:[]}};
  const matching=prepareSimpleMatching(facts,request);assert.equal(matching.financial.costInputs[0].lineMappings[0].quantity,80);assert.equal(matching.financial.acknowledged,false);assert.equal(matching.financial.prepared,true);assert.equal(matching.stockAdjustment,undefined);assert.deepEqual(matching.rows,[]);assert.deepEqual(matching.farms,[]);
  assert.equal(normalizeApprovalMatching(matching).financial.prepared,true);
  assert.equal(prepareSimpleMatching(facts,{...request,reviewedBy:'support'}),request.matching);
  const changed=structuredClone(facts);changed.receiptPlan.after[0].ProdKey=2;assert.equal(prepareSimpleMatching(changed,request).financial.costInputs[0].lineMappings[0].quantity,100);
});

test('actual API handler: farm and quantity open→automatic preparation→signed preview; prepared cannot bypass final confirmation/token/revision',async()=>{
  const secret='synthetic-test-secret';let commits=0;
  const source=fs.readFileSync(new URL('../pages/api/warehouse/approval.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export const config','const config').replace('export default withAuth','const handler=withAuth');
  let request;
  const handler=new Function('withAuth','getJwtSecret','jwt','query','withTransaction','sql','approvalPermissions','approvalError','listIncomingApprovals','readApproval','assertApprovalAccess','assertApprovalRevision','mutateIncomingApproval','readIncomingApprovalFacts','incomingApprovalBaseline','previewIncomingApproval','commitIncomingApproval','suggestedIncomingApprovalCostInputs',`${source};return handler;`)(h=>h,()=>secret,jwt,()=>{},()=>{},{},approvalPermissions,approvalError,()=>[],async()=>({RequestId:1,Status:'requested',payload:request}),()=>{},(row,rev)=>{if(row.payload.revision!==rev)throw approvalError('APPROVAL_STALE','stale');},async({input})=>{request={...request,matching:normalizeApprovalMatching(input.matching),revision:request.revision+1,reviewedBy:'support'};return {revision:request.revision};},async()=>({receipt:{header,details:before},receiptPlan:plan(request.correction),products,masters:[],details:[],dates:[],farmAssignments:[],farms:[],receiptMappingSuggestions:suggestReceiptMappings(plan(request.correction))}),()=>{},async()=>({preview:{canCommit:true,digest:'a'.repeat(64),financialHash:'b'.repeat(64),issues:[],receiptPlan:plan(request.correction),receipt:{header},correction:request.correction,groups:[]}}),async({input})=>{assert.equal(input.confirmed,true);commits++;return {};},()=>[]);
  const call=async(body,id)=>{const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.value=value;return this;}};await handler({method:body?'POST':'GET',body,query:{requestId:id},user:{userId:'support',deptName:'영업지원'}},res);if(!res.value.success)throw Object.assign(new Error(res.value.error),{code:res.value.code});return res.value;};
  for(const c of [{...scope,mode:'FARM',editKind:'FARM',farmName:'Farm B'},correction('QUANTITY',{items:[resizeReceiptItem(receiptItem(before[0],products),80,'단')]})]){
    const priorCommits=commits;
    request={requestId:1,status:'requested',revision:1,reason:'수정 사유',correction:c,matching:{rows:[],farms:[]}};
    const value=await prepareSimpleReview(call,await call(null,1));assert.equal(value.preview.canCommit,true);assert.ok(value.preview.previewToken);assert.equal(request.matching.financial.acknowledged,false);assert.equal(commits,priorCommits);
    await assert.rejects(()=>call({action:'approve',requestId:1,revision:2,digest:value.preview.digest,matching:request.matching,confirmed:true}),{code:'APPROVAL_REVIEW_EXPIRED'});
    await assert.rejects(()=>call({action:'approve',requestId:1,revision:1,digest:value.preview.digest,previewToken:value.preview.previewToken,confirmed:true}),{code:'APPROVAL_REVIEW_MISMATCH'});
    await assert.rejects(()=>call({action:'approve',requestId:1,revision:2,digest:value.preview.digest,previewToken:value.preview.previewToken,matching:request.matching}),{code:'APPROVAL_FAILED'});
    assert.equal(commits,priorCommits);
    await call({action:'approve',requestId:1,revision:2,digest:value.preview.digest,previewToken:value.preview.previewToken,confirmed:true});
  }
  assert.equal(commits,2);
});
