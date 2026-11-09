import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validatePackingPdf} from '../lib/importTeamPdf.js';
import {readPackingProviderResponse,packingProviderFailureCode} from '../lib/importPackingProviderStream.js';
import {PACKING_CHUNK_VERSION,splitPackingPdf,chunkExtractionPrompt,runPackingChunks} from '../lib/importPackingPdfChunks.js';
import {readPackingPdfChunk,updatePackingPdfChunk} from '../lib/importTeamPdfJobs.js';
import {PDFDocument} from 'pdf-lib';
import {packingPdfCacheKey,PDF_ANALYSIS_MODEL} from '../lib/importTeamPdfCache.js';
import {PDF_JOB_TIMEOUT_MS,getPackingPdfJob,findPackingPdfJobByKey,startPackingPdfJob,markPackingPdfAttempt,finishPackingPdfJob,markPackingPdfCacheSaved} from '../lib/importTeamPdfJobs.js';

const source=await fs.readFile(new URL('../pages/api/import/tools/parse-pdf.js',import.meta.url),'utf8');
const code='const {readPackingProviderResponse,packingProviderFailureCode,PACKING_CHUNK_VERSION,splitPackingPdf,chunkExtractionPrompt,runPackingChunks,readPackingPdfChunk,updatePackingPdfChunk}=arguments[arguments.length-1];\n'+source.replace(/^import .*;\r?\n/gm,'').replace('export const config=','const config=').replace('export default withAuth','const handler=withAuth')+'\nreturn handler;';
const pdfBase64=Buffer.from('%PDF-1.7\nfixture').toString('base64');
const body={country:'NL',pdfBase64,async:true};
const data={content:[{type:'text',text:'{"invoices":[]}'}],stop_reason:'end_turn',usage:{input_tokens:5,output_tokens:7}};

test('CO real PDF request resumes completed segments and performs final reconciliation before success',()=>setup(async h=>{
  const pdf=await PDFDocument.create();for(let i=0;i<4;i++)pdf.addPage();
  const input={country:'CO',pdfBase64:await pdf.saveAsBase64(),async:true};
  let failed=false;
  h.setFetch(async(url,options)=>{
    const request=JSON.parse(options.body),isSecond=request.system.includes('original pages 4.');
    if(isSecond&&!failed){failed=true;throw Object.assign(Error('mock timeout'),{name:'TimeoutError'});}
    const count=isSecond?1:3;
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({
      covered_pages:Array.from({length:count},(_,i)=>({page:i+1,kind:i===0?'invoice':'supporting'})),
      invoices:[{supplier:'Farm',invoice:isSecond?'B':'A',currency:'USD',freight_total:0,invoice_total:10,products:[{description:'Rose',t_price:10}]}]
    })}]})};
  });
  const first=await h.request('POST','alice',input);
  const terminal=await h.waitJob('alice',first.body.jobId);assert.equal(terminal.body.status,'FAILED');assert.equal(h.fetchCalls,2);
  const replay=await h.request('POST','alice',input);assert.equal(replay.body.status,'FAILED');assert.equal(h.fetchCalls,2);
  const retry=await h.request('POST','alice',{...input,retryJobId:first.body.jobId});
  const success=await h.waitJob('alice',retry.body.jobId);assert.equal(success.body.status,'SUCCEEDED');assert.equal(h.fetchCalls,3);
  assert.equal(JSON.parse(success.body.result.content[0].text).invoices.length,2);
}));
function response() {
  return {code:200,body:null,headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.code=value;return this;},json(value){this.body=value;return this;}};
}
async function setup(fn) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-api-'));
  const acceptedJobs=new Set();
  const oldKey=process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY='mock-only';
  try{
    let fetchCalls=0,quotaCalls=0,trackCalls=0,cacheWrites=0;
    const markErrors=[],finishErrors=[];
    const finishedJobs=new Set();
    let fetchImpl=async()=>({ok:true,json:async()=>data});
    let quotaImpl=async()=>{};
    let startImpl=(uid,key,opts)=>startPackingPdfJob(uid,key,{root,...opts});
    let finishImpl=(uid,id,token,value)=>finishPackingPdfJob(uid,id,token,value,{root});
    let cache=null;
    // docling 전처리 스텁: 기본은 미적용(기존 계약 그대로). setDocling 으로 주입 경로 검증 가능.
    let doclingImpl={applies:()=>false,record:null};
    const handler=new Function('withAuth','validatePackingPdf','buildPrompt','trackLLMCall','reservePackingPdfRequest','packingPdfCacheKey','readPackingPdfCache','writePackingPdfCache','PDF_ANALYSIS_MODEL','PDF_JOB_TIMEOUT_MS','getPackingPdfJob','findPackingPdfJobByKey','startPackingPdfJob','markPackingPdfAttempt','finishPackingPdfJob','markPackingPdfCacheSaved','doclingApplies','doclingWaitMs','doclingPdfSha','readDoclingResult','enqueueDoclingJob','waitForDoclingResult','buildDoclingPromptBlock','checkTablesArithmetic','appendDoclingMetrics','fetch','AbortSignal',code)(
      fn=>fn,validatePackingPdf,()=> 'fixed prompt',()=>{trackCalls++;},async()=>{quotaCalls++;await quotaImpl();},packingPdfCacheKey,async()=>cache,async()=>{cacheWrites++;return true;},PDF_ANALYSIS_MODEL,PDF_JOB_TIMEOUT_MS,
      (uid,id)=>getPackingPdfJob(uid,id,{root}),(uid,key)=>findPackingPdfJobByKey(uid,key,{root}),(uid,key,opts)=>startImpl(uid,key,opts),async(uid,id,token)=>{try{return await markPackingPdfAttempt(uid,id,token,{root});}catch(error){markErrors.push(error.code||error.name);throw error;}},async(uid,id,token,value)=>{try{const result=await finishImpl(uid,id,token,value);if(result?.status==='SUCCEEDED'||result?.status==='FAILED')finishedJobs.add(id);return result;}catch(error){finishErrors.push(error.stack||String(error));throw error;}},(uid,id,token)=>markPackingPdfCacheSaved(uid,id,token,{root}),
      country=>doclingImpl.applies(country),()=>50,()=>'a'.repeat(64),async()=>doclingImpl.record,async()=>({enqueued:true}),async()=>doclingImpl.record,record=>record&&record.markdown?'\nCANDIDATE BLOCK\n'+record.markdown:'',()=>({checked:0,flagged:[]}),async()=>{},
      (...args)=>{fetchCalls++;return fetchImpl(...args);},AbortSignal,{readPackingProviderResponse,packingProviderFailureCode,PACKING_CHUNK_VERSION,splitPackingPdf,chunkExtractionPrompt,runPackingChunks,
        readPackingPdfChunk:(uid,id,token,index,pages)=>readPackingPdfChunk(uid,id,token,index,pages,{root}),
        updatePackingPdfChunk:(uid,id,token,value)=>updatePackingPdfChunk(uid,id,token,value,{root})}
    );
    const request=async(method,user='alice',value=body,query={})=>{
      const res=response();await handler({method,user:{userId:user},body:value,query},res);
      if(method==='POST'&&res.code===202&&res.body?.jobId)acceptedJobs.add(res.body.jobId);
      return res;
    };
    const waitJob=async(user,id)=>{
      assert.match(id,/^[0-9a-f-]{36}$/,'a job ID must be accepted before polling');
      let last;
      for(let i=0;i<100;i++){
        const res=await request('GET',user,undefined,{jobId:id});
        last=res;
        assert.equal(res.code,200,'polling must not treat an API error as a terminal job');
        if(['SUCCEEDED','FAILED'].includes(res.body?.status)&&finishedJobs.has(id))return res;
        assert.equal(res.body?.status==='RUNNING'||['SUCCEEDED','FAILED'].includes(res.body?.status),true);
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      throw Error(`job did not terminate; last=${JSON.stringify(last?.body)}; fetchCalls=${fetchCalls}; markErrors=${JSON.stringify(markErrors)}; finishErrors=${JSON.stringify(finishErrors)}`);
    };
    const waitFetchCalls=async count=>{
      for(let i=0;i<100;i++){
        if(fetchCalls>=count)return;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      throw Error(`expected ${count} mock provider dispatches; observed ${fetchCalls}`);
    };
    return await fn({request,waitJob,waitFetchCalls,root,get fetchCalls(){return fetchCalls;},get quotaCalls(){return quotaCalls;},get trackCalls(){return trackCalls;},get cacheWrites(){return cacheWrites;},get markErrors(){return markErrors;},setFetch(value){fetchImpl=value;},setQuota(value){quotaImpl=value;},setCache(value){cache=value;},setStart(value){startImpl=value;},setFinish(value){finishImpl=value;},setDocling(value){doclingImpl=value;}});
  }finally{
    if(oldKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey;
    // SUCCEEDED is persisted before the detached runner finishes its cache marker.
    for(const id of acceptedJobs){
      for(let i=0;i<100;i++){
        const job=await getPackingPdfJob('alice',id,{root});
        if(!job||job.status==='FAILED'||(job.status==='SUCCEEDED'&&job.result?.cacheSaved===true))break;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
    }
    await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25});
  }
}

test('async POST 202, same-key reconnect, GET result, cross-user denial and success replay',()=>setup(async h=>{
  let release;
  h.setFetch(()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>data});}));
  const first=await h.request('POST');
  assert.equal(first.code,202);assert.match(first.body.jobId,/^[0-9a-f-]{36}$/);assert.equal(first.body.status,'RUNNING');
  const second=await h.request('POST');
  assert.deepEqual(second.body,first.body);
  await h.waitFetchCalls(1);
  assert.equal(h.fetchCalls,1);assert.equal(h.quotaCalls,1);
  const other=await h.request('GET','bob',undefined,{jobId:first.body.jobId});
  assert.equal(other.code,404);
  const busy=await h.request('POST','alice',{...body,pdfBase64:Buffer.from('%PDF-other').toString('base64')});
  assert.equal(busy.code,429);assert.equal(busy.body.error.code,'BUSY');
  release();
  const terminal=await h.waitJob('alice',first.body.jobId);
  assert.equal(terminal.code,200);assert.equal(terminal.body.status,'SUCCEEDED');
  assert.deepEqual(terminal.body.result.content,data.content);
  assert.equal(terminal.body.result.stop_reason,'end_turn');assert.equal(terminal.body.result.source,'ai');
  assert.equal(typeof terminal.body.result.cacheSaved,'boolean');
  assert.equal(h.trackCalls,1);
  const replay=await h.request('POST');
  assert.equal(replay.code,200);assert.equal(replay.body.status,'SUCCEEDED');assert.equal(h.fetchCalls,1);
  assert.equal((await h.request('GET','alice',undefined,{jobId:'../bad'})).code,404);
}));

test('provider timeout and non-JSON response become readable FAILED, without retries',()=>setup(async h=>{
  h.setFetch(async()=>{throw Object.assign(Error('private detail'),{name:'TimeoutError'});});
  const first=await h.request('POST');
  const failed=await h.waitJob('alice',first.body.jobId);
  assert.equal(failed.code,200);assert.equal(failed.body.status,'FAILED');
  assert.equal(failed.body.error.code,'PDF_ANALYSIS_UNCERTAIN');assert.doesNotMatch(failed.body.error.message,/private/);
  assert.equal(h.fetchCalls,1);
  h.setFetch(async()=>({ok:true,json:async()=>{throw Error('not JSON');}}));
  const second=await h.request('POST','alice',{...body,pdfBase64:Buffer.from('%PDF-another').toString('base64')});
  assert.equal(second.code,202);
  const secondFailed=await h.waitJob('alice',second.body.jobId);
  assert.equal(secondFailed.body.status,'FAILED');
  assert.equal(h.fetchCalls,2,`provider dispatch missing; markErrors=${JSON.stringify(h.markErrors)}; terminal=${JSON.stringify(secondFailed.body)}`);
}));

test('quota failure and cache hit never call provider',()=>setup(async h=>{
  h.setQuota(async()=>{throw Object.assign(Error('hourly limit'),{statusCode:429,retryAfter:60});});
  const limited=await h.request('POST');
  assert.equal(limited.code,429);assert.equal(limited.headers['Retry-After'],60);assert.equal(h.fetchCalls,0);
  h.setQuota(async()=>{});
  const retried=await h.request('POST');
  assert.equal(retried.code,202);
  assert.equal((await h.waitJob('alice',retried.body.jobId)).body.status,'SUCCEEDED');
  assert.equal(h.fetchCalls,1);
  h.setCache({content:data.content,stop_reason:'end_turn'});
  const cached=await h.request('POST');
  assert.equal(cached.code,200);assert.equal(cached.body.source,'cache');assert.equal(h.fetchCalls,1);
}));

test('storage failure fails closed before provider call',()=>setup(async h=>{
  h.setStart(async()=>{throw Error('disk permission private');});
  const res=await h.request('POST');
  assert.equal(res.code,503);assert.equal(h.fetchCalls,0);assert.doesNotMatch(res.body.error.message,/private/);
}));

test('post-dispatch durable result failure records uncertain status and never caches',()=>setup(async h=>{
  let failedOnce=false;
  h.setFinish(async(uid,id,token,value)=>{
    if(value.result&&!failedOnce){failedOnce=true;throw Error('write failed');}
    return finishPackingPdfJob(uid,id,token,value,{root:h.root});
  });
  const started=await h.request('POST');
  const failed=await h.waitJob('alice',started.body.jobId);
  assert.equal(failed.body.status,'FAILED');assert.equal(failed.body.error.code,'PDF_ANALYSIS_UNCERTAIN');
  assert.equal(h.cacheWrites,0);assert.equal(h.fetchCalls,1);
  assert.equal((await h.request('POST')).body.status,'FAILED');assert.equal(h.fetchCalls,1);
}));

test('legacy sync and async POST share one provider attempt',()=>setup(async h=>{
  let release;
  h.setFetch(()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>data});}));
  const asyncPost=await h.request('POST');
  const syncPending=h.request('POST','alice',{...body,async:false});
  await h.waitFetchCalls(1);
  assert.equal(h.fetchCalls,1);
  const busy=await h.request('POST','alice',{...body,async:false,pdfBase64:Buffer.from('%PDF-other').toString('base64')});
  assert.equal(busy.code,429);
  release();
  const sync=await syncPending;
  assert.equal(sync.code,200);assert.deepEqual(sync.body.content,data.content);
  assert.equal((await h.waitJob('alice',asyncPost.body.jobId)).body.status,'SUCCEEDED');
  assert.equal(h.fetchCalls,1);
}));

test('dispatched failure replays by default; confirmed retry ID alone permits another attempt',()=>setup(async h=>{
  h.setFetch(async()=>{throw Error('network dropped');});
  const first=await h.request('POST');
  const failed=await h.waitJob('alice',first.body.jobId);
  assert.equal(failed.body.error.code,'PDF_ANALYSIS_UNCERTAIN');
  assert.equal(failed.body.retryJobId,first.body.jobId);
  const replay=await h.request('POST');
  assert.equal(replay.code,200);assert.equal(replay.body.status,'FAILED');assert.equal(h.fetchCalls,1);
  const invalid=await h.request('POST','alice',{...body,retryJobId:'bad'});
  assert.equal(invalid.code,400);assert.equal(h.fetchCalls,1);
  const mismatched=await h.request('POST','alice',{...body,retryJobId:'00000000-0000-4000-8000-000000000000'});
  assert.equal(mismatched.code,400);assert.equal(h.fetchCalls,1);
  h.setFetch(async()=>({ok:true,json:async()=>data}));
  const retry=await h.request('POST','alice',{...body,retryJobId:first.body.jobId});
  assert.equal(retry.code,202);assert.notEqual(retry.body.jobId,first.body.jobId);
  assert.equal((await h.waitJob('alice',retry.body.jobId)).body.status,'SUCCEEDED');
  assert.equal(h.fetchCalls,2);
}));

test('retry identity is checked before cached replay and sync known failure omits retryJobId',()=>setup(async h=>{
  h.setCache({content:data.content,stop_reason:'end_turn'});
  const invalid=await h.request('POST','alice',{...body,retryJobId:'00000000-0000-4000-8000-000000000000'});
  assert.equal(invalid.code,400);assert.equal(h.fetchCalls,0);
  h.setCache(null);
  h.setStart(async()=>({kind:'TERMINAL',job:{jobId:'00000000-0000-4000-8000-000000000001',status:'FAILED',error:{message:'known no-attempt failure'}}}));
  const known=await h.request('POST','alice',{...body,async:false});
  assert.equal(known.code,502);assert.equal(known.body.retryJobId,undefined);
}));

test('docling 전처리: 적용 시 시스템 프롬프트에 후보표 블록 추가, 미적용/결과없음 시 기존 프롬프트 그대로',()=>setup(async h=>{
  let lastBody;
  h.setFetch(async(url,options)=>{lastBody=JSON.parse(options.body);return {ok:true,json:async()=>data};});
  h.setDocling({applies:()=>true,record:{ok:true,markdown:'| 4 | 100 | 400 |',tables:[]}});
  const first=await h.request('POST');
  await h.waitJob('alice',first.body.jobId);
  assert.match(lastBody.system,/^fixed prompt/);
  assert.match(lastBody.system,/CANDIDATE BLOCK/);
  assert.equal(lastBody.messages[0].content[0].type,'document'); // PDF 는 계속 첨부(증거 계약)
  // 결과 없음(워커 지연) → 블록 없이 기존 그대로
  h.setDocling({applies:()=>true,record:null});
  const second=await h.request('POST','alice',{...body,pdfBase64:Buffer.from('%PDF-second').toString('base64')});
  await h.waitJob('alice',second.body.jobId);
  assert.equal(lastBody.system,'fixed prompt');
  // 미적용(off/NL) → 기존 그대로
  h.setDocling({applies:()=>false,record:{ok:true,markdown:'x',tables:[]}});
  const third=await h.request('POST','alice',{...body,pdfBase64:Buffer.from('%PDF-third').toString('base64')});
  await h.waitJob('alice',third.body.jobId);
  assert.equal(lastBody.system,'fixed prompt');
}));
