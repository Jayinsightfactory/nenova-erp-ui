import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {splitPackingPdf,chunkExtractionPrompt,parsePackingChunk,mergePackingChunks,runPackingChunks} from '../lib/importPackingPdfChunks.js';
import {startPackingPdfJob,markPackingPdfAttempt,finishPackingPdfJob,readPackingPdfChunk,updatePackingPdfChunk,getPackingPdfJob} from '../lib/importTeamPdfJobs.js';
const invoice=(id='A',amount=10)=>({supplier:'Farm',invoice:id,currency:'USD',invoice_total:amount,freight_total:0,products:[{description:'Flower',t_price:amount,review_evidence:{description:{page:1,quote:'Flower'}}}]});
const payload=value=>({content:[{type:'text',text:JSON.stringify(value)}],stop_reason:'end_turn'});
const segment=(invoices,pages=[1])=>({pages,result:{invoices}});

test('coverage prompt states exact JSON keys, integer local pages, count and supporting pages',()=>{
  const prompt=chunkExtractionPrompt([7,8,9]);
  for(const required of ['EXACTLY 3 objects','local page 1, 2, 3','{"page":1,"kind":"invoice"}','INTEGER local page number','blank/certificate/AWB pages as supporting'])assert.ok(prompt.includes(required),required);
});
test('coverage errors distinguish malformed AI output from actual missing source pages',()=>{
  const response=covered_pages=>payload({invoices:[invoice()],covered_pages});
  assert.throws(()=>parsePackingChunk(response([{page:1,type:'invoice'}]),[1]),/형식.*원본 PDF 누락을 뜻하지/);
  assert.throws(()=>parsePackingChunk(response([null]),[1]),/형식/);
  assert.throws(()=>parsePackingChunk(response([{page:1,kind:'invoice'}]),[1,2]),/필요 2쪽.*응답 1쪽/);
  assert.throws(()=>parsePackingChunk(response([{page:7,kind:'invoice'}]),[7]),/1~1쪽/);
});

test('actual PDF split covers every original page once and preserves dimensions',async()=>{
  const pdf=await PDFDocument.create();for(let i=0;i<7;i++)pdf.addPage([400+i,600]);
  const chunks=await splitPackingPdf(await pdf.saveAsBase64());
  assert.deepEqual(chunks.map(c=>c.pages),[[1,2,3],[4,5,6],[7]]);
  for(const chunk of chunks){const restored=await PDFDocument.load(chunk.pdfBase64);assert.equal(restored.getPageCount(),chunk.pages.length);assert.equal(restored.getPage(0).getWidth(),399+chunk.pages[0]);}
  await assert.rejects(splitPackingPdf(await pdf.saveAsBase64(),{pagesPerChunk:0}));
});
test('strict completion/coverage and original evidence page mapping',()=>{
  const data=payload({invoices:[invoice()],covered_pages:[{page:1,kind:'invoice'},{page:2,kind:'supporting'}]});
  assert.equal(parsePackingChunk(data,[4,5]).invoices[0].products[0].review_evidence.description.page,4);
  assert.throws(()=>parsePackingChunk({...data,stop_reason:'max_tokens'},[4,5]));
  assert.throws(()=>parsePackingChunk(payload({invoices:[invoice()],covered_pages:[{page:1,kind:'invoice'},{page:1,kind:'invoice'}]}),[4,5]));
  assert.throws(()=>parsePackingChunk(payload({invoices:[],covered_pages:[{page:1,kind:'invoice'}]}),[1]));
  assert.throws(()=>parsePackingChunk(payload({invoices:[],covered_pages:[{page:1,kind:'manifest'}]}),[1]));
  assert.throws(()=>parsePackingChunk({content:[{type:'text',text:'{"invoices":['}],stop_reason:'end_turn'},[1]));
});
test('merged continuation preserves amounts/units and checks printed total including extras',()=>{
  const first=invoice('A',10);first.invoice_total=null;first.freight_total=null;
  const second=invoice('A',20);second.invoice_total=35;second.freight_total=5;second.products[0].review_evidence.description.page=2;
  const result=mergePackingChunks([segment([first]),segment([second],[2])],2);
  const row=JSON.parse(result.content[0].text).invoices[0];assert.equal(row.products.length,2);assert.equal(row.freight_total,5);assert.equal(row.invoice_total,35);
  second.invoice_total=36;assert.throws(()=>mergePackingChunks([segment([first]),segment([second],[2])],2),/총액/);
});
test('missing pages, duplicate fragments, conflicting totals and manifest mismatch block receipt result',()=>{
  assert.throws(()=>mergePackingChunks([segment([invoice()],[2])],1));
  assert.throws(()=>mergePackingChunks([segment([invoice()]),segment([invoice()],[2])],2),/중복/);
  const manifest=segment([]);manifest.result.manifest_invoices=[{invoice:'B'}];
  assert.throws(()=>mergePackingChunks([manifest,segment([invoice()],[2])],2),/목록/);
  const missing=invoice();missing.freight_total=null;assert.throws(()=>mergePackingChunks([segment([missing])],1));
});
test('farm-only manifest reconciles exact unique supplier without inventing invoice numbers',()=>{
  const manifest=segment([]);manifest.result.manifest_invoices=[{invoice:null,supplier:'Farm'}];
  assert.equal(JSON.parse(mergePackingChunks([manifest,segment([invoice()],[2])],2).content[0].text).invoices.length,1);
  assert.throws(()=>mergePackingChunks([manifest,segment([invoice('A'),invoice('B')],[2])],2),/목록/);
});
test('failed segment is not auto-retried; completed segment reused on explicit second run',async()=>{
  const plan=[{pages:[1]},{pages:[2]}],cache=new Map();let calls=0,fail=true;
  const options={plan,load:async i=>cache.get(i),claim:async()=>{},save:async(i,p,r)=>cache.set(i,r),analyze:async(c,i)=>{
    calls++;if(i===1&&fail)throw Error('timeout');return payload({invoices:[invoice(String(i))],covered_pages:[{page:1,kind:'invoice'}]});
  }};
  await assert.rejects(runPackingChunks(options),/timeout/);assert.equal(calls,2);assert.equal(cache.size,1);
  fail=false;const result=await runPackingChunks(options);assert.equal(calls,3);assert.equal(JSON.parse(result.content[0].text).invoices.length,2);
});
test('durable fenced segments survive only an explicit same-source retry; cross-user lookup denied',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-chunks-')),opts={root};
  try{
    const first=await startPackingPdfJob('alice','a'.repeat(64),opts);const id=first.job.jobId,token=first.token;
    await markPackingPdfAttempt('alice',id,token,opts);
    await updatePackingPdfChunk('alice',id,token,{index:0,pages:[1]},opts);
    await assert.rejects(updatePackingPdfChunk('alice',id,token,{index:0,pages:[1]},opts),/claimed/);
    await updatePackingPdfChunk('alice',id,token,{index:0,pages:[1],result:{invoices:[invoice()]}},opts);
    await finishPackingPdfJob('alice',id,token,{error:{message:'timeout',code:'PDF_ANALYSIS_UNCERTAIN'}},opts);
    assert.equal((await startPackingPdfJob('alice','a'.repeat(64),opts)).kind,'TERMINAL');
    const retry=await startPackingPdfJob('alice','a'.repeat(64),{...opts,retryJobId:id});
    assert.equal((await readPackingPdfChunk('alice',retry.job.jobId,retry.token,0,[1],opts)).invoices.length,1);
    assert.equal(await getPackingPdfJob('bob',retry.job.jobId,opts),null);
    await assert.rejects(updatePackingPdfChunk('alice',retry.job.jobId,'stale',{index:1,pages:[2]},opts),/owner/);
    await finishPackingPdfJob('alice',retry.job.jobId,retry.token,{error:{message:'test complete'}},opts);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
