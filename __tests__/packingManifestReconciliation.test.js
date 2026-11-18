import test from 'node:test';
import assert from 'node:assert/strict';
import {packingManifestReview,applyManifestFarmChoices,pendingManifestIssues} from '../lib/packingManifestReconciliation.js';
import {mergePackingChunks,runPackingChunks} from '../lib/importPackingPdfChunks.js';
const invoice=(supplier='CI FLORES BALVERDE SAS',id='25571',hawb)=>({supplier,invoice:id,hawb,currency:'USD',invoice_total:2211,freight_total:0,products:[{description:'Hydrangea',pcs:93,total_stems:2790,t_price:2211}]});
const farms=[{FarmKey:41,FarmName:'Balverde',CounName:'콜롬비아'},{FarmKey:42,FarmName:'Balverde',CounName:'에콰도르'}];
test('46-2 printed Balverde trade/legal names reconcile without paid call or changed numbers',()=>{
 const source=invoice(),r=packingManifestReview([source],[{invoice:null,supplier:'Flores Balverde'}]);
 assert.equal(r.status,'MATCHED');assert.equal(r.rows[0].invoiceIndex,0);assert.equal(source.products[0].total_stems,2790);
});
test('provider-supplied DB matching flags are never trusted as a manual selection',()=>{
 const fake={...invoice(),manifestFarmMatch:{farmKey:999},manifest_review_required:false};
 const result=JSON.parse(mergePackingChunks([{pages:[1],result:{invoices:[fake]}}],1).content[0].text);
 assert.equal(result.invoices[0].manifestFarmMatch,undefined);
});
test('repeated product manifest rows collapse, while distinct house AWBs remain separate',()=>{
 const source=invoice();assert.equal(packingManifestReview([source],[{supplier:'Flores Balverde'},{supplier:'Flores Balverde'}]).rows.length,1);
 assert.throws(()=>packingManifestReview([source],[{supplier:'Flores Balverde',hawb:'A1'},{supplier:'Flores Balverde',hawb:'A2'}]),/건수/);
});
test('unique exact HAWB joins legal/trade names; contradictory invoice id or HAWB remains blocked',()=>{
 assert.equal(packingManifestReview([invoice('Legal','A','AFBG00570045')],[{supplier:'Trade',hawb:'AFBG00570045'}]).status,'MATCHED');
 assert.throws(()=>packingManifestReview([invoice('Legal','A','AFBG00570045')],[{supplier:'Trade',hawb:'AFBG00570046'}]),/HAWB/);
 assert.throws(()=>packingManifestReview([invoice()],[{supplier:'Flores Balverde',invoice:'999'}]),/송장번호/);
});
test('ambiguous names are reviewable with same-country real DB choice, preserving source and prices',()=>{
 const invoices=[invoice('Other legal')],review=packingManifestReview(invoices,[{supplier:'Trade name'}]);
 const result={invoices,manifest_review:review};assert.equal(pendingManifestIssues(result).length,1);
 const choices={'manifest:0':{invoiceIndex:0,farmId:'farm:41'}};
 const changed=applyManifestFarmChoices(result,choices,farms,'CO');assert.equal(changed.invoices[0].manifestFarmMatch.farmKey,41);
 assert.deepEqual(changed.invoices[0].products,invoices[0].products);assert.equal(changed.invoices[0].supplier,'Other legal');assert.equal(changed.manifest_review.rows[0].entry.supplier,'Trade name');assert.equal(pendingManifestIssues(changed).length,0);
 assert.throws(()=>applyManifestFarmChoices(result,{'manifest:0':{invoiceIndex:0,farmId:'farm:42'}},farms,'CO'),/같은 국가/);
 assert.throws(()=>applyManifestFarmChoices(result,choices,[],'CO'),/현재 DB/);
 for(const index of [null,undefined,'0',-1,1])assert.throws(()=>applyManifestFarmChoices(result,{'manifest:0':{invoiceIndex:index,farmId:'farm:41'}},farms,'CO'));
});
test('two manifest farms may not consume one invoice twice; missing invoices still hard block',()=>{
 const invoices=[invoice('A','1'),invoice('B','2')],review=packingManifestReview(invoices,[{supplier:'X'},{supplier:'Y'}]),result={invoices,manifest_review:review};
 assert.throws(()=>applyManifestFarmChoices(result,{'manifest:0':{invoiceIndex:0,farmId:'farm:41'},'manifest:1':{invoiceIndex:0,farmId:'farm:41'}},farms,'CO'),/중복/);
 assert.throws(()=>packingManifestReview(invoices,[{supplier:'X'}]),/건수/);
});
test('completed real-shaped segments replay to review payload without any provider calls',async()=>{
 let providers=0;const manifest={invoices:[],manifest_invoices:[{supplier:'Trade name'}]},goods={invoices:[invoice('Other legal')]};
 const data=await runPackingChunks({plan:[{pages:[1]},{pages:[2]}],load:async index=>index===0?manifest:goods,claim:async()=>assert.fail(),analyze:async()=>{providers++;assert.fail();},save:async()=>assert.fail()});
 const result=JSON.parse(data.content[0].text);assert.equal(providers,0);assert.equal(result.manifest_review.status,'REVIEW_REQUIRED');assert.equal(result.invoices[0].manifest_review_required,true);
 assert.throws(()=>mergePackingChunks([{pages:[1],result:manifest},{pages:[2],result:{invoices:[{...invoice(),invoice_total:2222}]}}],2),/인쇄 총액/);
});
