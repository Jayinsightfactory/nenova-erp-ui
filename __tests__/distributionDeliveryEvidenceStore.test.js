const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createDistributionDeliveryEvidenceStore, evidenceKey } = require('../lib/distributionDeliveryEvidenceStore');
const source = { source:'nenovakakao',chat_id:'sales',external_message_id:'1',identity:'nenovakakao|sales|1',chatroom:'영업방',message:'장미 추가 3박스',created_at:'2026-10-09T10:00:00+09:00' };
const target = { ...source,chat_id:'delivery',external_message_id:'2',chatroom:'현장 추가취소방',created_at:'2026-10-09T10:01:00+09:00' };
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-evidence-'));
 try {
  const first=createDistributionDeliveryEvidenceStore({directory,now:()=>new Date('2026-10-09T02:00:00Z')});
  assert.equal(await first.read({source,year:'2026'}),null);
  const results=await Promise.all(Array.from({length:12},(_,i)=>first.confirm({source,target:{...target,external_message_id:String(i+2)},year:'2026'})));
  assert(results.every(record=>record.persisted===true&&record.deliveryIdentity===results[0].deliveryIdentity),'one complete immutable winner under concurrent writes');
  const restartedOtherAccount=createDistributionDeliveryEvidenceStore({directory,now:()=>new Date('2027-10-09T02:00:00Z')});
  assert.deepEqual(await restartedOtherAccount.read({source,year:'2026'}),results[0],'restart/account changes and age do not expire verified evidence');
  for(const change of [{message:source.message+' '},{created_at:'2026-10-09T10:00:01+09:00'},{external_message_id:'new',identity:'nenovakakao|sales|new'},{timestamp_approximate:true},{source:'uploaded-kakao'}])assert.equal(await first.read({source:{...source,...change},year:'2026'}),null);
  assert.equal(await first.read({source,year:'2025'}),null);
  for(const change of [{message:'different'},{created_at:'2025-10-09T10:01:00+09:00'},{created_at:'2026-10-09T09:59:00+09:00'},{timestamp_approximate:true}])await assert.rejects(first.confirm({source,target:{...target,...change},year:'2026'}),/unverified/);
  assert.deepEqual(await first.read({source,year:'2026'}),results[0],'invalid new evidence cannot erase saved confirmation');
  assert(!fs.readFileSync(path.join(directory,evidenceKey(source,'2026')+'.json'),'utf8').includes(source.message),'stored record contains fingerprint, not source raw text');
  assert.equal(fs.readdirSync(directory).length,1,'temporary files cleaned');
  console.log('distribution delivery evidence store tests passed');
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
