import assert from 'node:assert/strict';
import { saveReceiptProductMatch } from '../lib/receiptProductMatchClient.js';
for (const country of ['NL','CN','CO','EC','TH','AU','US','VN']) {
 const calls=[];
 const fetchFn=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({success:true,revision:7})};};
 await saveReceiptProductMatch({reviewedMetadata:{country}},{originalName:'Test',sourceEvidence:{matchingDescription:'Source variety'}},{ProdKey:123},fetchFn);
 assert.equal(calls.length,2);assert.equal(calls[0].init.cache,'no-store');
 assert.deepEqual(JSON.parse(calls[1].init.body),{country,description:'Source variety',prodKey:123,expectedRevision:7});
}
let called=false;
assert.deepEqual(await saveReceiptProductMatch({reviewedMetadata:{country:'AU'}},{originalName:'Woolly bush',sourceEvidence:{allocationSourceId:'one'}},{ProdKey:1},async()=>{called=true;}),{documentOnly:true});
assert.equal(called,false);
await assert.rejects(()=>saveReceiptProductMatch({reviewedMetadata:{country:'NL'}},{originalName:'Rose',sourceEvidence:{}},{ProdKey:1},async()=>({ok:false,json:async()=>({success:false,error:'동시 수정'})})),/동시 수정/);
console.log('PASS receipt matching: 8 countries CAS, conflict retained, Woolly file-only');
