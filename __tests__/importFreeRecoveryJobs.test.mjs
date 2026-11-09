import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {startPackingPdfJob,markPackingPdfAttempt,updatePackingPdfChunk,finishPackingPdfJob,recoverPackingPdfJobFree} from '../lib/importTeamPdfJobs.js';
async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'free-recover-')),opts={root},key='b'.repeat(64);
 try{
  const admitted=await startPackingPdfJob('alice',key,opts),id=admitted.job.jobId,token=admitted.token;
  await markPackingPdfAttempt('alice',id,token,opts);
  for(let i=0;i<4;i++){await updatePackingPdfChunk('alice',id,token,{index:i,pages:[i+1]},opts);if(i<3)await updatePackingPdfChunk('alice',id,token,{index:i,pages:[i+1],result:{invoices:[{invoice:String(i),original:true}]}},opts);}
  await finishPackingPdfJob('alice',id,token,{error:{message:'old failure'}},opts);
  const file=path.join(root,createHash('sha256').update('alice').digest('hex'),id+'.json');
  const plan=Array.from({length:4},(_,index)=>({index,pages:[index+1],result:{invoices:[{invoice:String(index),original:false}]}}));
  await fn({id,key,opts,file,plan});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('exact three stored completed chunks survive free recovery byte-for-byte',()=>fixture(async({id,key,opts,file,plan})=>{
 const before=JSON.parse(await fs.readFile(file)),prefix=JSON.stringify(before.chunks.slice(0,3));
 const result=await recoverPackingPdfJobFree('alice',id,key,{plan,reviewIssues:[{code:'HAWB_REVIEW'}],merge:chunks=>{
  assert.equal(chunks[0].result.invoices[0].original,true);assert.equal(chunks[3].result.invoices[0].original,false);
  return {content:[],stop_reason:'end_turn'};
 }},opts);
 assert.equal(result.status,'SUCCEEDED');assert.equal(result.revalidation.preserved,3);assert.equal(result.revalidation.providerCalls,0);assert.equal(result.revalidation.issues.length,1);
 const after=JSON.parse(await fs.readFile(file));assert.equal(JSON.stringify(after.chunks.slice(0,3)),prefix);
}));
test('failed merge cannot change any stored bytes',()=>fixture(async({id,key,opts,file,plan})=>{
 const before=await fs.readFile(file,'utf8');await assert.rejects(()=>recoverPackingPdfJobFree('alice',id,key,{plan,merge:()=>{throw Error('total mismatch');}},opts));assert.equal(await fs.readFile(file,'utf8'),before);
}));
test('other account/source cannot recover saved chunks',()=>fixture(async({id,key,opts,plan})=>{
 assert.equal(await recoverPackingPdfJobFree('bob',id,key,{plan,merge:()=>assert.fail()},opts),null);
 assert.equal(await recoverPackingPdfJobFree('alice',id,'a'.repeat(64),{plan,merge:()=>assert.fail()},opts),null);
}));
