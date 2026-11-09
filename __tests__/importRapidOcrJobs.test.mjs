import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRapidOcrJob,getRapidOcrJob,claimRapidOcrJob,finishRapidOcrJob} from '../lib/importRapidOcrJobs.js';
const pdfBase64=Buffer.from('%PDF-1.4\nfixture').toString('base64');
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'rapidocr-test-'));try{await fn({root});}finally{await fs.rm(root,{recursive:true,force:true});}}
test('owner/source cache and worker completion, no original PDF in public result',()=>fixture(async opts=>{
 const a=await createRapidOcrJob('u',{country:'CO',pdfBase64},opts),b=await createRapidOcrJob('u',{country:'CO',pdfBase64},opts);assert.equal(a.jobId,b.jobId);assert.equal(a.providerCalls,0);assert.equal(a.pdfBase64,undefined);assert.equal(await getRapidOcrJob('other',a.jobId,opts),null);
 const claim=await claimRapidOcrJob(opts);assert.equal(claim.jobId,a.jobId);assert.equal(await claimRapidOcrJob(opts),null);
 const result={sourceHash:a.sourceHash,pages:[{page:1,width:100,height:100,items:[{str:'Total 342',x:1,y:2,width:30,height:5}]}]};
 await finishRapidOcrJob({...claim,result},opts);const done=await getRapidOcrJob('u',a.jobId,opts);assert.equal(done.status,'SUCCEEDED');assert.deepEqual(done.result,result);
 const privateRow=JSON.parse(await fs.readFile(path.join(opts.root,a.jobId+'.json')));assert.equal(privateRow.pdfBase64,undefined);assert.equal(privateRow.claimToken,undefined);
}));
test('simultaneous admission and claims are exclusive',()=>fixture(async opts=>{
 const list=await Promise.all(Array.from({length:5},()=>createRapidOcrJob('u',{country:'AU',pdfBase64},opts)));assert.equal(new Set(list.map(x=>x.jobId)).size,1);
 const claims=await Promise.all([claimRapidOcrJob(opts),claimRapidOcrJob(opts)]);assert.equal(claims.filter(Boolean).length,1);
}));
test('wrong claimant/source cannot finish',()=>fixture(async opts=>{
 await createRapidOcrJob('u',{country:'CO',pdfBase64},opts);const c=await claimRapidOcrJob(opts);
 await assert.rejects(()=>finishRapidOcrJob({...c,claimToken:'0'.repeat(36),error:true},opts));await assert.rejects(()=>finishRapidOcrJob({...c,sourceHash:'b'.repeat(64),error:true},opts));
}));
test('missing page/invalid coordinate blocked and job remains running',()=>fixture(async opts=>{
 const job=await createRapidOcrJob('u',{country:'CO',pdfBase64},opts),c=await claimRapidOcrJob(opts);
 await assert.rejects(()=>finishRapidOcrJob({...c,result:{sourceHash:c.sourceHash,pages:[{page:2,width:10,height:10,items:[]}]}},opts));assert.equal((await getRapidOcrJob('u',job.jobId,opts)).status,'RUNNING');
}));
test('invalid PDF and path-like identifiers rejected',()=>fixture(async opts=>{
 await assert.rejects(()=>createRapidOcrJob('u',{country:'CO',pdfBase64:'notpdf'},opts));assert.equal(await getRapidOcrJob('u','../private',opts),null);
}));
