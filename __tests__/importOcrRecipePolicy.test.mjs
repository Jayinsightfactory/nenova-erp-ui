import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOcrRecipeRows,mergeFreeOcrWithCompleted} from '../lib/importOcrRecipePolicy.js';
const row=(sourceId,extra={})=>({sourceId,page:27,role:'product',totalStems:100,unitPrice:.38,amount:38,...extra});
test('Tiba recipe duplicates remain evidence, not a second charge',()=>{
 const input=[row('p'),row('r',{role:'recipe',parentSourceId:'p'})],before=JSON.stringify(input);
 const out=resolveOcrRecipeRows(input);assert.equal(out.products.length,1);assert.equal(out.recipeEvidence[0].excludedRepeatedAmount,38);assert.equal(JSON.stringify(input),before);
});
test('legitimate equal-valued distinct product rows are retained',()=>assert.equal(resolveOcrRecipeRows([row('a'),row('b')]).products.length,2));
test('missing parent blocks rather than silently deleting recipe',()=>assert.throws(()=>resolveOcrRecipeRows([row('r',{role:'recipe',parentSourceId:'missing'})]),{code:'OCR_RECIPE_PARENT'}));
test('different-page parent blocks',()=>assert.throws(()=>resolveOcrRecipeRows([row('p'),row('r',{role:'recipe',parentSourceId:'p',page:28})]),{code:'OCR_RECIPE_PARENT'}));
test('inconsistent recipe or amount blocks irrespective of confidence',()=>assert.throws(()=>resolveOcrRecipeRows([row('p'),row('r',{role:'recipe',parentSourceId:'p',totalStems:200,amount:76,confidence:1})]),{code:'OCR_RECIPE_TOTAL'}));
test('duplicate source id blocks',()=>assert.throws(()=>resolveOcrRecipeRows([row('p'),row('p')]),{code:'OCR_SOURCE_ID'}));
test('mixed-box components reconcile to the parent without extra money',()=>{
 const out=resolveOcrRecipeRows([row('p',{totalStems:300,unitPrice:.1,amount:30}),row('a',{role:'recipe',parentSourceId:'p',totalStems:160,unitPrice:.1,amount:16}),row('b',{role:'recipe',parentSourceId:'p',totalStems:140,unitPrice:.1,amount:14})]);assert.equal(out.products[0].amount,30);
});
const hash='a'.repeat(64),chunk=(index,pages)=>({index,pages,sourceHash:hash,status:'SUCCEEDED',result:{covered_pages:pages,invoices:[]}});
test('preserves exact 3 completed results while combining remaining chunks',()=>{
 const old=[chunk(0,[1,2,3]),chunk(1,[4,5,6]),chunk(2,[7,8,9])],before=JSON.stringify(old);
 const out=mergeFreeOcrWithCompleted({sourceHash:hash,completedChunks:old,freeChunks:[chunk(3,[10,11,12])],pageCount:12});
 assert.equal(out.preservedCount,3);assert.equal(out.chunks[0].result,old[0].result);assert.equal(JSON.stringify(old),before);assert.equal(out.providerCalls,0);
});
for(const [label,mutate] of [['source',c=>c.sourceHash='b'.repeat(64)],['page',c=>c.pages=[5,6]],['index',c=>c.index=0],['state',c=>c.status='RUNNING']])test('rejects altered '+label,()=>{
 const free=chunk(1,[4,5,6]);mutate(free);assert.throws(()=>mergeFreeOcrWithCompleted({sourceHash:hash,completedChunks:[chunk(0,[1,2,3])],freeChunks:[free],pageCount:6}));
});
