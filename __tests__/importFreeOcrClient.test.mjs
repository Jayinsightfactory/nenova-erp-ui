import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFreePackingDocument} from '../lib/importFreeOcrClient.js';
const response=(status,data)=>({ok:status<400,status,json:async()=>data});
test('free route uses only cache/OCR/recovery endpoints and returns merged result',async()=>{
 const calls=[];let polls=0;
 const out=await extractFreePackingDocument({country:'CO',pdfBase64:'PDF',sleep:async()=>{},fetchImpl:async(url,options={})=>{
  const b=options.body?JSON.parse(options.body):null;calls.push([url,b]);
  if(b?.cacheOnly)return response(404,{error:{message:'not cached'}});
  if(url==='/api/import/tools/free-ocr')return response(202,{job:{jobId:'job',status:'QUEUED'}});
  if(url.includes('free-ocr?'))return response(200,{job:{jobId:'job',status:++polls===1?'RUNNING':'SUCCEEDED',result:{pages:[]}}});
  if(b?.freeOcrJobId)return response(200,{status:'SUCCEEDED',result:{content:[],source:'free-ocr'},revalidation:{preserved:3}});
  assert.fail('unexpected paid/write request');
 }});
 assert.equal(out.source,'free-ocr');assert.equal(out.revalidation.preserved,3);
 assert.equal(calls.some(([,b])=>b?.allowAI||b?.async),false);assert.equal(calls.length,5);
});
test('cached result does not queue OCR or request a paid analysis',async()=>{
 let calls=0;const out=await extractFreePackingDocument({country:'CO',pdfBase64:'PDF',fetchImpl:async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).cacheOnly,true);return response(200,{content:[],source:'cache'});}});assert.equal(calls,1);assert.equal(out.source,'cache');
});
test('unsupported country never makes a request',async()=>{await assert.rejects(()=>extractFreePackingDocument({country:'TH',pdfBase64:'PDF',fetchImpl:()=>assert.fail()}),/유료 분석을 자동 실행하지/);});
test('worker timeout preserves job, with no paid fallback',async()=>{
 let time=0,calls=0;await assert.rejects(()=>extractFreePackingDocument({country:'CO',pdfBase64:'PDF',now:()=>time,sleep:async()=>{time+=190000;},fetchImpl:async(url,options={})=>{calls++;if(options.body&&JSON.parse(options.body).cacheOnly)return response(404,{});return response(200,{job:{jobId:'job',status:'QUEUED'}});}}),/유료 분석으로 전환하지/);assert.equal(calls,3);
});
