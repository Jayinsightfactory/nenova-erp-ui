import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPackingDocument,waitForPackingPdfJob} from '../lib/importPackingExtractClient.js';
test('local failure never calls paid AI without explicit selection',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({source:'cache',content:[],stop_reason:'end_turn'}));};
 for(const country of ['CO','NL']){
  const result=await extractPackingDocument({country,pdfBase64:'x',readPdf:async()=>{throw Error('scan');},fetchImpl});
  assert.equal(result.needsAI,true);
 }
 assert.equal(calls,0);
 const result=await extractPackingDocument({country:'CO',pdfBase64:'x',allowAI:true,fetchImpl});
 assert.equal(calls,1);assert.equal(result.source,'cache');
});

const jobId='11111111-1111-4111-8111-111111111111';
const result={content:[{type:'text',text:'{"invoices":[]}'}],stop_reason:'end_turn',source:'ai',cacheSaved:true};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('async accepted analysis polls GET only and preserves the full response',async()=>{
 const methods=[],progress=[];let reads=0;
 const fetchImpl=async(url,options)=>{
  methods.push(options.method);
  if(options.method==='POST'){assert.equal(JSON.parse(options.body).async,true);return json({jobId,status:'RUNNING'},202);}
  assert.equal(url,`/api/import/tools/parse-pdf?jobId=${jobId}`);
  return json(++reads===1?{jobId,status:'RUNNING'}:{jobId,status:'SUCCEEDED',result});
 };
 const actual=await extractPackingDocument({country:'CN',pdfBase64:'async-source',allowAI:true,fetchImpl,sleep:async()=>{},onProgress:p=>progress.push(p.stage)});
 assert.deepEqual(actual.data,result);assert.deepEqual(methods,['POST','GET','GET']);assert.ok(progress.includes('ANALYZING'));
});
test('lost polling connection resumes the same job without another paid POST',async()=>{
 const methods=[];let fail=true;
 const fetchImpl=async(url,options)=>{methods.push(options.method);if(options.method==='POST')return json({jobId,status:'RUNNING'},202);if(fail)throw Error('offline');return json({jobId,status:'SUCCEEDED',result});};
 const args={country:'CN',pdfBase64:'resume-source',allowAI:true,fetchImpl,sleep:async()=>{}};
 await assert.rejects(()=>extractPackingDocument(args),/같은 작업 결과/);
 fail=false;assert.equal((await extractPackingDocument(args)).source,'ai');
 assert.deepEqual(methods,['POST','GET','GET']);
});
test('provider terminal failure stops without automatic new analysis',async()=>{
 let calls=0;
 await assert.rejects(()=>waitForPackingPdfJob({jobId,fetchImpl:async()=>{calls++;return json({status:'FAILED',error:{message:'분석 시간 초과'}});},sleep:async()=>{}}),/분석 시간 초과/);
 assert.equal(calls,1);
});
test('invalid jobs, missing ownership and malformed gateway responses fail closed',async()=>{
 let calls=0;await assert.rejects(()=>waitForPackingPdfJob({jobId:'../../secret',fetchImpl:async()=>{calls++;}}),/작업 번호/);assert.equal(calls,0);
 for(const status of [401,403,404])await assert.rejects(()=>waitForPackingPdfJob({jobId,fetchImpl:async()=>json({},status)}),error=>error.pdfJobTerminal===true);
 await assert.rejects(()=>waitForPackingPdfJob({jobId,fetchImpl:async()=>new Response('<html>gateway</html>',{status:504})}),/기존 결과부터/);
});
test('polling deadline never retries POST or claims complete',async()=>{
 let clock=0,calls=0;
 await assert.rejects(()=>waitForPackingPdfJob({jobId,now:()=>clock,timeoutMs:10,fetchImpl:async(url,options)=>{calls++;assert.equal(options.method,'GET');return json({status:'RUNNING'});},sleep:async()=>{clock+=11;}}),/대기 시간이/);
 assert.equal(calls,1);
});

test('uncertain paid attempt requires an explicit retry identity and never retries on its own',async()=>{
 const methods=[];
 const fetchImpl=async(url,options)=>{methods.push(options.method);return json({status:'FAILED',error:{code:'PDF_ANALYSIS_UNCERTAIN',message:'이전 분석 결과 불명'},retryJobId:jobId});};
 await assert.rejects(()=>extractPackingDocument({country:'CN',pdfBase64:'uncertain-source',allowAI:true,fetchImpl}),error=>error.pdfRetryJobId===jobId);
 assert.deepEqual(methods,['POST']);
 let body;
 await extractPackingDocument({country:'CN',pdfBase64:'uncertain-source',allowAI:true,retryJobId:jobId,fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return json(result);}});
 assert.equal(body.retryJobId,jobId);
});
