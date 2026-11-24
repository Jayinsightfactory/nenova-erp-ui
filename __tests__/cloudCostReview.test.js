import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkCostReview,calculateCloudReviewedRows,reviewRowSignature,reviewKey} from '../lib/cloudCostReview.js';
import {createCloudCostReviewHandler} from '../lib/cloudCostReviewHttp.js';
import {readImportTeamRecord,writeImportTeamRecord} from '../lib/importTeamStore.js';
const id=n=>`00000000-0000-5000-a000-${String(n).padStart(12,'0')}`;
function setup(){
 const rows=[1,2,3].map(n=>({lineId:id(n),lineNo:n,wdetailKey:n,prodKey:n,outQuantity:n===1?60:10,outUnit:'단',lineAmount:n===1?1200:200,unitPrice:20,originalName:`TEST_ONLY ${n}`}));
 const member={warehouseKey:1,invoiceNo:'TEST_ONLY',awb:'RECEIPT:2026:47-02:1',sourceHash:'whole-source',farmName:'Cloudland',rows,lineInputs:rows.map(r=>({lineId:r.lineId,categoryCode:r.lineNo===1?null:1})),reviewSource:{lines:rows.map(r=>({wdetailKey:r.wdetailKey,prodKey:r.prodKey,quantity:r.outQuantity,amount:r.lineAmount,unit:r.outUnit,currency:'CNY'}))}};
 const p={scope:{country:'CN',orderYear:'2026',orderWeek:'47-02'},selectedKeys:[1],baselineDigest:'baseline',members:[member],awbs:[{awb:member.awb,members:[member]}]};
 const d={version:1,mode:'TEST_ONLY',baselineDigest:'baseline',rows:Object.fromEntries(rows.map(r=>[r.lineId,{basis:'ERP',...(r.lineNo===1?{manualFreight:7.48,manualDuty:1010,manualReason:'TEST_ONLY H34/M34'}:{})}])),lineInputs:member.lineInputs,awbInputs:[{awb:member.awb,input:{gw:100,cw:120,exchangeRate:210,permitAmount:0,reviewReason:'TEST_ONLY 원가표 재현',financialReviewConfirmed:false}}],expensePools:[],confirmations:{}};
 for(const row of rows)d.confirmations[row.lineId]=reviewRowSignature(member,row,d);
 const inputs=new Map(d.awbInputs.map(a=>[a.awb,a.input])),amounts=new Map([[member.awb,{FREIGHT:1000,CUSTOMS:8000}]]);
 return {p,d,member,rows,inputs,amounts};
}
test('manual freight first, residual CBM and duty exact; no manufactured box/tariff; source immutable',()=>{
 const {p,d,inputs,amounts}=setup(),before=JSON.stringify(p),r=calculateCloudReviewedRows(p,d,inputs,amounts);
 assert.equal(r[0].componentAmounts.freightNative,448.8);assert.equal(r[0].componentAmounts.tariffKRW,60600);
 assert.equal(r[1].componentAmounts.freightNative,275.6);assert.equal(r[2].componentAmounts.freightNative,275.6);
 assert.ok(Math.abs(r.reduce((s,l)=>s+l.componentAmounts.freightNative,0)-1000)<1e-8);assert.equal(r.reduce((s,l)=>s+l.componentAmounts.customsKRW,0),8000);
 assert.equal(JSON.stringify(p),before);amounts.values().next().value.FREIGHT=400;assert.throws(()=>calculateCloudReviewedRows(p,d,inputs,amounts),/초과/);
});
test('source-only applied price with reason; ERP retains old value; changed row only reconfirms',()=>{
 const {p,d,member,rows}=setup();member.reviewSource.lines[1].amount=20;d.rows[rows[1].lineId]={basis:'SOURCE',reason:'CI reference amount'};
 d.confirmations[rows[1].lineId]=reviewRowSignature(member,rows[1],d);assert.equal(checkCostReview(p,d,{requireConfirmed:true})[1].lineAmount,20);assert.equal(rows[1].lineAmount,200);
 d.rows[rows[1].lineId].reason='changed';assert.notEqual(d.confirmations[rows[1].lineId],reviewRowSignature(member,rows[1],d));assert.equal(d.confirmations[rows[2].lineId],reviewRowSignature(member,rows[2],d));assert.throws(()=>checkCostReview(p,d,{requireConfirmed:true}),/다시 확인/);
 d.rows[rows[1].lineId].reason='';assert.throws(()=>checkCostReview(p,d),/사유/);
});
test('header costs invalidate own scope; whole-source change does not invalidate unrelated unchanged row',()=>{
 const {d,member,rows}=setup();member.sourceHash='other-row-changed';assert.equal(d.confirmations[rows[1].lineId],reviewRowSignature(member,rows[1],d));
 d.awbInputs[0].input.gw=101;assert.notEqual(d.confirmations[rows[1].lineId],reviewRowSignature(member,rows[1],d));
 assert.notEqual(reviewKey({country:'CN',orderYear:'2026',orderWeek:'47-02',selectedKeys:[1]}),reviewKey({country:'CN',orderYear:'2025',orderWeek:'47-02',selectedKeys:[1]}));
});
test('unknown/negative/manual partial costs and falsified financial approval blocked',()=>{
 for(const mutate of [d=>d.rows[id(1)].manualDuty='',d=>d.rows[id(1)].manualDuty=-1,d=>d.rows[id(1)].manualFreight=' ',d=>d.rows[id(1)].manualReason='',d=>d.rows[id(9)]={basis:'ERP'}]){const {p,d}=setup();mutate(d);assert.throws(()=>checkCostReview(p,d,{requireConfirmed:true}));}
 const {p,d,inputs,amounts}=setup();inputs.values().next().value.financialReviewConfirmed=true;for(const m of p.members)for(const row of m.rows)d.confirmations[row.lineId]=reviewRowSignature(m,row,d);assert.throws(()=>calculateCloudReviewedRows(p,d,inputs,amounts),/재무 승인/);
});
const response=()=>({code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('server shared draft two users revision conflict; cross-scope/stale/unauthorized rejected; ledger never written',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cost-review-test-'));try{
  const {p,d}=setup(),handler=createCloudCostReviewHandler({authorize:u=>!!u.allowed,prepare:async()=>p,readRecord:key=>readImportTeamRecord(key,{root}),writeRecord:(key,r)=>writeImportTeamRecord(key,r,{root})});
  const call=async(body,user={allowed:true,userId:'TEST_ONLY',userName:'TEST_ONLY'})=>{const r=response();await handler({method:'POST',body,user},r);return r;};
  const one=await call({action:'save',value:d,expectedRevision:0});assert.equal(one.code,200);assert.equal(one.body.revision,1);
  const two=await call({action:'load'},{allowed:true,userId:'TEST_ONLY-second'});assert.equal(two.body.value.rows[id(1)].manualFreight,7.48);
  const conflict=await call({action:'save',value:d,expectedRevision:0});assert.equal(conflict.code,409);
  const stale=await call({action:'save',value:{...d,baselineDigest:'changed'},expectedRevision:1});assert.equal(stale.code,409);
  const outside=await call({action:'save',value:{...d,rows:{...d.rows,[id(9)]:{basis:'ERP'}}},expectedRevision:1});assert.equal(outside.code,400);
  assert.equal((await call({action:'load'},{})).code,403);
 }finally{await fs.rm(root,{recursive:true});}
});

test('source amount cannot change currency or physical unit implicitly',()=>{for(const patch of [{currency:'USD'},{unit:'박스'}]){const {p,d,member,rows}=setup();Object.assign(member.reviewSource.lines[1],patch);d.rows[rows[1].lineId]={basis:'SOURCE',reason:'TEST_ONLY'};assert.throws(()=>checkCostReview(p,d),/원문 적용/);}});
