import test from 'node:test';
import assert from 'node:assert/strict';
import {CLOUD_CATEGORIES,cloudCostPreview,matchCloudCategory,isCloudInvoice} from '../lib/chinaCloudCost.js';
const document={orderYear:'2026',orderWeek:'46-02',reviewedMetadata:{country:'CN',transportMode:'AIR',farmName:'CLOUD'}};
const rows=[{lineId:'a',prodKey:1,unit:'BUNCH',actualQuantity:30,bunchQuantity:30,lineAmount:600},{lineId:'b',prodKey:2,unit:'BUNCH',actualQuantity:350,bunchQuantity:350,lineAmount:3500}];
const input={customsTotalKRW:100000,lineInputs:[{lineId:'a',categoryCode:1},{lineId:'b',categoryCode:4}]};
const common={nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRate:210,effectiveFreightAmount:24087};
test('source has 21 explicit editable categories; specific rose subtype wins, ambiguous or unknown names stay pending',()=>{
 assert.equal(CLOUD_CATEGORIES.length,21);assert.equal(matchCloudCategory('ROSE A grade White'),9);
 assert.equal(matchCloudCategory('유칼립투스'),4);assert.equal(matchCloudCategory('ROSE CARNATION'),null);assert.equal(matchCloudCategory('unknown'),null);
});
test('CLOUD CBM freight, 3 percent CNF surcharge and bunch customs reconcile independently',()=>{
 const issues=[],out=cloudCostPreview(document,rows,input,common,issues);assert.deepEqual(issues,[]);
 const weights=[30,350*130*38*26/6000/10],denominator=weights[0]+weights[1];
 const expected=rows.map((r,i)=>((r.lineAmount+24087*weights[i]/denominator)*210*1.03)*(1+CLOUD_CATEGORIES[[0,3][i]].tariffRate)+100000*r.actualQuantity/380);
 out.lines.forEach((r,i)=>assert.ok(Math.abs(r.totalCostKRW-expected[i])<1e-6));
 assert.ok(Math.abs(out.lines.reduce((s,r)=>s+r.componentAmounts.freightNative,0)-24087)<1e-6);
 assert.ok(Math.abs(out.lines.reduce((s,r)=>s+r.componentAmounts.customsKRW,0)-100000)<1e-6);
});
test('HUBFRESH, conflicting farm evidence, missing category, wrong unit and missing customs fail closed; explicit zero survives',()=>{
 assert.equal(isCloudInvoice({...document,rawMetadata:{supplier:'HUBFRESH'}}),false);
 for(const [doc,lines,values] of [[{...document,reviewedMetadata:{...document.reviewedMetadata,farmName:'HUBFRESH'}},rows,input],[document,rows,{...input,lineInputs:[]}],[document,[{...rows[0],unit:'STEM'}],input],[document,rows,{...input,customsTotalKRW:''}]]){
  const issues=[];assert.equal(cloudCostPreview(doc,lines,values,common,issues).lines.length,0);assert.ok(issues.length);
 }
 const issues=[];const out=cloudCostPreview({...document,orderYear:'2025'},rows,{...input,customsTotalKRW:0},common,issues);assert.deepEqual(issues,[]);assert.equal(out.lines[0].componentAmounts.customsKRW,0);
});
