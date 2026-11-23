import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CLOUD_CATEGORIES,cloudCostPreview,matchCloudCategory,isCloudInvoice} from '../lib/chinaCloudCost.js';
const document={orderYear:'2026',orderWeek:'46-02',reviewedMetadata:{country:'CN',transportMode:'AIR',farmName:'CLOUD'}};
const rows=[{lineId:'a',prodKey:1,unit:'BUNCH',actualQuantity:30,bunchQuantity:30,lineAmount:600},{lineId:'b',prodKey:2,unit:'BUNCH',actualQuantity:350,bunchQuantity:350,lineAmount:3500}];
const input={customsTotalKRW:100000,lineInputs:[{lineId:'a',categoryCode:1},{lineId:'b',categoryCode:4}]};
const common={nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRate:210,effectiveFreightAmount:24087};

test('owner workbook 46-2: all 43 rows and 2280 bunches reconcile to cached Q values',()=>{
 const source=JSON.parse(readFileSync(new URL('./fixtures/cloud-cost-46-2.json',import.meta.url),'utf8'));
 const data=source.rows.map((r,i)=>({lineId:String(i),prodKey:i+1,unit:'BUNCH',actualQuantity:r.quantity,bunchQuantity:r.quantity,lineAmount:r.quantity*r.price}));
 const issues=[],out=cloudCostPreview(document,data,{customsTotalKRW:source.customs,lineInputs:source.rows.map((r,i)=>({lineId:String(i),categoryCode:r.categoryCode}))},{...common,exchangeRate:source.fx,effectiveFreightAmount:source.freight},issues);
 assert.deepEqual(issues,[]);assert.equal(out.lines.length,43);assert.equal(data.reduce((s,r)=>s+r.actualQuantity,0),2280);
 out.lines.forEach((line,i)=>assert.ok(Math.abs(line.costPerUnitKRW-source.rows[i].expected)<1e-6,`source Q${source.rows[i].sourceRow}`));
 assert.ok(Math.abs(out.lines.reduce((s,r)=>s+r.totalCostKRW,0)-20110579.3157767)<1e-6);
 assert.equal(CLOUD_CATEGORIES[3].volumeKgPerBox,15);assert.equal(CLOUD_CATEGORIES[20].volumeKgPerBox,15);assert.equal(CLOUD_CATEGORIES[9].tariffRate,.032);
});
test('source has 21 explicit editable categories; specific rose subtype wins, ambiguous or unknown names stay pending',()=>{
 assert.equal(CLOUD_CATEGORIES.length,21);assert.equal(matchCloudCategory('ROSE A grade White'),9);
 assert.equal(matchCloudCategory('유칼립투스'),4);assert.equal(matchCloudCategory('ROSE CARNATION'),null);assert.equal(matchCloudCategory('unknown'),null);
});
test('CLOUD CBM freight, 3 percent CNF surcharge and bunch customs reconcile independently',()=>{
 const issues=[],out=cloudCostPreview(document,rows,input,common,issues);assert.deepEqual(issues,[]);
 const weights=[30*100*40*20/6000/10,350*15/10],denominator=weights[0]+weights[1];
 const expected=rows.map((r,i)=>(r.lineAmount+24087*weights[i]/denominator)*210*(1.03+CLOUD_CATEGORIES[[0,3][i]].tariffRate)+100000*r.actualQuantity/380);
 out.lines.forEach((r,i)=>assert.ok(Math.abs(r.totalCostKRW-expected[i])<1e-6));
 assert.ok(Math.abs(out.lines.reduce((s,r)=>s+r.componentAmounts.freightNative,0)-24087)<1e-6);
 assert.ok(Math.abs(out.lines.reduce((s,r)=>s+r.componentAmounts.customsKRW,0)-100000)<1e-6);
});
test('HUBFRESH, conflicting farm evidence, missing category, wrong unit and missing customs fail closed; explicit zero survives',()=>{
 assert.equal(isCloudInvoice({...document,rawMetadata:{supplier:'HUBFRESH'}}),false);
 assert.equal(isCloudInvoice({...document,reviewedMetadata:{...document.reviewedMetadata,farmName:'CLOUDLAND'}}),true);
 assert.equal(isCloudInvoice({...document,reviewedMetadata:{...document.reviewedMetadata,farmName:'Cloud land'}}),true);
 for(const [doc,lines,values] of [[{...document,reviewedMetadata:{...document.reviewedMetadata,farmName:'HUBFRESH'}},rows,input],[document,rows,{...input,lineInputs:[]}],[document,[{...rows[0],unit:'STEM'}],input],[document,rows,{...input,customsTotalKRW:''}]]){
  const issues=[];assert.equal(cloudCostPreview(doc,lines,values,common,issues).lines.length,0);assert.ok(issues.length);
 }
 const issues=[];const out=cloudCostPreview({...document,orderYear:'2025'},rows,{...input,customsTotalKRW:0},common,issues);assert.deepEqual(issues,[]);assert.equal(out.lines[0].componentAmounts.customsKRW,0);
});
