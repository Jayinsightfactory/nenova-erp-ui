import test from 'node:test';import assert from 'node:assert/strict';
import {mergePackingChunks} from '../lib/importPackingPdfChunks.js';
import {packingAmountIssues,invoiceAmountState,applyPackingAmountReview,suspectedSummaryRows} from '../lib/packingAmountReview.js';
import {parsePackingResponse} from '../lib/importPackingResponse.js';
import {packingValidationIssues} from '../lib/packingValidationIssues.js';
const sourceHash='b2176913b2a9f15d3e33354a0b4ad0e4f9956db8919c1f7de38947a6cf3a548c';
function invoice(){const boxes=[1,2,2,3,14,3,1,1];return {supplier:'AYURA SAS',invoice:'18065',currency:'USD',invoice_total:1741.5,freight_total:0,
 products:[...boxes.map((pcs,i)=>({description:'CARNATION fixture variety '+i,pcs,total_stems:pcs*300,u_price:.215,t_price:pcs*64.5,source_page:6})),{description:'CARNATION CARNATION CARNATION',pcs:27,total_stems:8100,u_price:.215,t_price:1741.5,source_page:7}]};}
function fixture(){return {amount_review_country:'CO',amount_review_source_hash:sourceHash,invoices:[invoice()]};}
const approved=()=>({0:{excluded:[8],reason:'원본7쪽은6쪽 상품의 집계',confirmed:true,events:[{kind:'EXCLUDE_SUMMARY',rowIndex:8}]}});
test('4702 review preserves all extracted rows and exposes recoverable mismatch before receipt',()=>{
 const input=invoice(),chunks=[{pages:Array.from({length:28},(_,i)=>i+1),result:{invoices:[input]}}];
 assert.throws(()=>mergePackingChunks(chunks,28,{sourceHash}),/3483/);
 const result=JSON.parse(mergePackingChunks(chunks,28,{sourceHash,reviewRecoverable:true}).content[0].text);
 assert.deepEqual(result.invoices[0].products,input.products);assert.equal(result.extractionIssues[0].code,'PACKING_AMOUNT_REVIEW_REQUIRED');
 assert.equal(result.amount_review_source_hash,sourceHash);assert.equal(packingAmountIssues(result).length,1);assert.deepEqual(suspectedSummaryRows(input),[8]);
});
test('4702 explicit summary exclusion and restore recompute totals without mutating source',()=>{
 const result=fixture(),before=structuredClone(result),drafts=approved();
 assert.equal(invoiceAmountState(result.invoices[0]).planned,3483);
 assert.equal(invoiceAmountState(result.invoices[0],drafts[0]).difference,0);
 const out=applyPackingAmountReview(result,drafts,{sourceHash,visitedPages:[7]});
 assert.equal(out.invoices[0].products.length,8);assert.deepEqual(out.invoices[0].products,before.invoices[0].products.slice(0,8));
 assert.equal(out.invoices[0].source_amount_review.excludedRows[0].row.t_price,1741.5);
 assert.deepEqual(result,before);assert.equal(packingAmountIssues(out).length,0);
 assert.equal(invoiceAmountState(result.invoices[0],{...drafts[0],excluded:[]}).difference,1741.5);
});
test('confirmation, reason, rendered source page and same hash are all required',()=>{
 for(const [change,options]of [[d=>d[0].confirmed=false,{sourceHash,visitedPages:[7]}],[d=>d[0].reason='',{sourceHash,visitedPages:[7]}],[()=>{}, {sourceHash,visitedPages:[6]}],[()=>{},{sourceHash:'a'.repeat(64),visitedPages:[7]}], [d=>d[0].excluded=[8,8],{sourceHash,visitedPages:[7]}]]){
  const drafts=approved();change(drafts);assert.throws(()=>applyPackingAmountReview(fixture(),drafts,options));
 }
});
test('invalid/missing/zero and unbalanced edits stay blocked; arbitrary fields forbidden',()=>{
 for(const edit of [{total_stems:null},{total_stems:0},{t_price:65},{pcs:-1},{u_price:null},{u_price:0}]){
  const drafts=approved();drafts[0].edits={0:edit};assert.throws(()=>applyPackingAmountReview(fixture(),drafts,{sourceHash,visitedPages:[6,7]}));
 }
 const drafts=approved();drafts[0].edits={0:{prodKey:999}};assert.throws(()=>applyPackingAmountReview(fixture(),drafts,{sourceHash,visitedPages:[6,7]}),/허용하지/);
});
test('normal invoices do not require review; issues cannot be cleared by spoofed status',()=>{
 const result=fixture();result.invoices[0].products.pop();assert.equal(packingAmountIssues(result).length,0);
 const pending=fixture();pending.extractionIssues=[];pending.amount_review_country=null;assert.equal(packingAmountIssues(pending).length,1);
});

test('actual parsed response revalidates edited totals without retaining the old double-count issue',()=>{
 const input=fixture();input.invoices[0].extractionIssues=[{code:'CURRENCY_REVIEW_REQUIRED',field:'currency',message:'must remain'}];
 const parsed=parsePackingResponse({content:[{type:'text',text:JSON.stringify(input)}],stop_reason:'end_turn'},'CO').result;
 assert(packingValidationIssues(parsed.invoices,'CO').some(i=>i.code==='INVOICE_TOTAL_MISMATCH'));
 const out=applyPackingAmountReview(parsed,approved(),{sourceHash,visitedPages:[7]});
 assert(!packingValidationIssues(out.invoices,'CO').some(i=>i.code==='INVOICE_TOTAL_MISMATCH'));
 assert(out.invoices[0].extractionIssues.some(i=>i.code==='CURRENCY_REVIEW_REQUIRED'));
 assert.equal(out.invoices[0].source_amount_review.excludedRows.length,1);
});
