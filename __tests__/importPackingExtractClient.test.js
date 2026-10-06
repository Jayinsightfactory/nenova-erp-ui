import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPackingDocument} from '../lib/importPackingExtractClient.js';
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
