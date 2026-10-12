const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const {createDistributionDeliveryEvidenceStore}=require('../lib/distributionDeliveryEvidenceStore');
const directories=[];
const helpers=require('../lib/distributionDeliveryStatus');
const {matchDeliveryStatus}=helpers;
const original={source:'nenovakakao',chat_id:'sales',external_message_id:'one',identity:'nenovakakao|sales|one',chatroom:'영업방',message:'업체 장미 3박스 추가\n취소 1박스',created_at:'2026-10-09T10:00:00+09:00'};
const delivered={...original,chat_id:'delivery',external_message_id:'two',chatroom:'현장 추가취소방',created_at:'2026-10-09T10:01:00+09:00'};
const match=(sources=[original],targets=[delivered],year='2026')=>matchDeliveryStatus({sources,targets,year});
assert.equal(match()[0].status,'DELIVERED');
assert.equal(match([{...original,message:original.message.replace('\n','   ')}])[0].status,'DELIVERED');
for(const change of [{timestamp_approximate:true},{created_at:'invalid'},{created_at:'2026-02-30T10:00:00+09:00'},{created_at:'2025-10-09T10:00:00+09:00'},{identity:'forged'},{source:'uploaded-kakao'},{message:'업체 장미 3박스 추가…'}])assert.equal(match([{...original,...change}])[0].status,'UNCONFIRMED');
for(const change of [{timestamp_approximate:true},{chatroom:'다른방'},{source:'other'},{created_at:'2026-10-09T09:59:00+09:00'},{message:'업체 장미 3박스 추가'},{external_message_id:''},{created_at:'2027-10-09T10:01:00+09:00'}])assert.equal(match(undefined,[{...delivered,...change}])[0].status,'UNCONFIRMED');
assert.equal(match(undefined,undefined,'2025')[0].status,'UNCONFIRMED');
assert.equal(match([original,{...original,identity:'nenovakakao|sales|different',external_message_id:'different'}])[0].status,'AMBIGUOUS');
assert.equal(match(undefined,[delivered,{...delivered,external_message_id:'three'}])[0].status,'AMBIGUOUS');
assert.equal(match(undefined,[delivered,delivered])[0].status,'AMBIGUOUS');
assert(!JSON.stringify(match()).includes(original.message),'response must not leak raw text');

assert.equal(match([{...original,timestamp_approximate:true}])[0].reason,'source_time_approximate');
assert.equal(match([{...original,chat_id:undefined}])[0].reason,'source_metadata');
assert.equal(match([{...original,truncated:true}])[0].reason,'incomplete');
assert.equal(match(undefined,[])[0].reason,'no_target');
assert.equal(match(undefined,undefined,'2025')[0].reason,'source_time_invalid');
assert.equal(match(undefined,[delivered,delivered])[0].reason,'ambiguous');
const realSource={...original,message:'41-1 콜 카네이션 변경사항\n상희\n돈셀 2박스 추가\n오늘 출고건입니다',created_at:'2026-10-12T02:50:00Z'};
const realTarget={...delivered,message:realSource.message.replace(/^41-1/u,'41-2'),created_at:'2026-10-12T03:02:00Z'};
const realMatch=(sources=[realSource],targets=[realTarget],year='2026')=>matchDeliveryStatus({sources,targets,year})[0];
assert.deepEqual(realMatch(),{identity:realSource.identity,status:'DELIVERED',reason:'week_corrected',sourceWeek:'41-01',targetWeek:'41-02',deliveryIdentity:'nenovakakao|delivery|two',deliveredAt:realTarget.created_at});
assert.equal(realMatch(undefined,[{...realTarget,message:realSource.message}]).status,'DELIVERED','exact match still takes precedence');
assert.equal(realMatch(undefined,[{...realTarget,message:realSource.message},realTarget]).status,'DELIVERED','an advisory candidate cannot downgrade an exact match');
assert.equal(realMatch([{...realSource,message:realSource.message.replace('41-1','41-01')}]).reason,'week_corrected');
assert.equal(realMatch([{...realSource,message:realSource.message.replace('41-1','41-1차')}],[{...realTarget,message:realTarget.message.replace('41-2','41-2차')}]).reason,'week_corrected');
for(const message of [
  realTarget.message.replace('2박스','3박스'),
  realTarget.message.replace('돈셀','다른 업체'),
  realTarget.message.replace('추가','취소'),
  realTarget.message.replace('41-2','41-02 다른 내용'),
  realTarget.message.replace('41-2','54-2'),
  realTarget.message.replace('41-2','41-00'),
  realTarget.message.replace('41-2','41-100'),
  realTarget.message.replace('41-2','안내 41-2'),
])assert.equal(realMatch(undefined,[{...realTarget,message}]).reason,'no_target',`not a sole valid leading week change: ${message}`);
for(const change of [
  {created_at:'2026-10-12T02:49:59Z'},
  {timestamp_approximate:true},
  {truncated:true},
  {message:'41-2 콜 카네이션 변경사항…'},
  {chatroom:'다른방'},
  {created_at:'2027-10-12T03:02:00Z'},
])assert.equal(realMatch(undefined,[{...realTarget,...change}]).reason,'no_target');
assert.equal(realMatch(undefined,[realTarget,{...realTarget,external_message_id:'three'}]).status,'AMBIGUOUS');
assert.equal(realMatch([realSource,{...realSource,identity:'nenovakakao|sales|another',external_message_id:'another'}]).status,'AMBIGUOUS');
assert.equal(realMatch([realSource,{...realSource,identity:'nenovakakao|sales|another',external_message_id:'another',message:realTarget.message}]).status,'AMBIGUOUS','competing correction sources must not both claim the target');
assert.equal(realMatch(undefined,[{...realTarget,message:realSource.message},realTarget]).status,'DELIVERED','exact remains valid with a correction candidate');
assert.equal(realMatch([{...realSource,message:'41-1'}],[{...realTarget,message:'41-2'}]).status,'UNCONFIRMED','week token alone is not a complete body');
assert(!JSON.stringify(realMatch()).includes(realTarget.message),'corrected response must not leak target text');
function harness(fetchImpl,{token='test-token',store}={}){
 if(!store){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-api-'));directories.push(directory);store=createDistributionDeliveryEvidenceStore({directory});}
 const source=fs.readFileSync(require.resolve('../pages/api/kakao/delivery-status.js'),'utf8')
  .replace("import { withAuth } from '../../../lib/auth';",'const {withAuth}=deps;')
  .replace("import { periodBounds } from '../../../lib/distributionSalesInbox';",'const {periodBounds}=deps;')
  .replace("import { recentSalesPeriod } from '../../../lib/distributionSalesInboxRefresh';",'const {recentSalesPeriod}=deps;')
  .replace("import { DELIVERY_ROOM, deliveryIdentity, matchDeliveryStatus } from '../../../lib/distributionDeliveryStatus';",'const {DELIVERY_ROOM,deliveryIdentity,matchDeliveryStatus}=deps;')
  .replace("import { createDistributionDeliveryEvidenceStore } from '../../../lib/distributionDeliveryEvidenceStore';",'const {createDistributionDeliveryEvidenceStore}=deps;')
  .replace('export default withAuth','module.exports=withAuth').replace('export const config=','const config=');
 const context={module:{exports:{}},deps:{...helpers,createDistributionDeliveryEvidenceStore:()=>store,periodBounds:require('../lib/distributionSalesInbox').periodBounds,recentSalesPeriod:()=>({from:'2026-10-07',to:'2026-10-09'}),withAuth:handler=>(req,res)=>req.user?handler(req,res):res.status(401).json({error:'unauthenticated'})},fetch:fetchImpl,process:{env:{NENOVA_SALES_READ_TOKEN:token}},URL,Date,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(source,context);
 return async(overrides={})=>{const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await context.module.exports({method:'POST',user:{userId:'actor',accountActive:true},body:{year:'2026',week:'2026-41-01',sources:[original]},...overrides},res);return res;};
}
(async()=>{
 let reads=0;const handler=harness(async(url,options)=>{reads++;assert.equal(new URL(url).pathname,'/api/kakao/nenova-delivery-feed');assert.equal(options.headers.Authorization,'Bearer test-token');return {ok:true,json:async()=>({ok:true,messages:[delivered],hasMore:false,nextAfterKey:null})};});
 assert.equal((await handler({user:null})).code,401);assert.equal(reads,0);
 assert.equal((await handler({user:{accountActive:false}})).code,403);assert.equal((await handler({method:'GET'})).code,405);
 for(const body of [{year:'2025',week:'2026-41-01',sources:[original]},{year:'2026',week:'2026-00-00',sources:[original]},{year:'2026',week:'2026-41-01',sources:Array(201).fill(original)}])assert.equal((await handler({body})).code,400);
 const result=await handler();assert.equal(result.code,200);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.data.items[0].status,'DELIVERED');assert.equal(result.data.diagnostics.targetCount,1);assert.equal(result.data.diagnostics.qualifiedSourceCount,1);await handler();assert.equal(reads,1,'successful fixed feed cached');
 assert.equal((await harness(()=>{throw Error('no fetch');},{token:''})()).code,503);
 let pages=0;const capped=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[{...delivered,external_message_id:String(++pages)}],hasMore:true,nextAfterKey:String(pages)})}));assert.equal((await capped()).code,502);assert.equal(pages,20);await capped();assert.equal(pages,40,'incomplete failure is not cached');
 const wrongRoom=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[{...delivered,chatroom:'other'}],hasMore:false,nextAfterKey:null})}));assert.equal((await wrongRoom()).code,502);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-shared-'));directories.push(directory);
 const store=createDistributionDeliveryEvidenceStore({directory});
 const initial=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[delivered],hasMore:false,nextAfterKey:null})}),{store});
 assert.equal((await initial()).data.items[0].persisted,true);
 let failedReads=0;const restarted=harness(async()=>{failedReads++;throw Error('upstream unavailable');},{store:createDistributionDeliveryEvidenceStore({directory})});
 const otherAccount=await restarted({user:{userId:'different-account'},body:{year:'2026',week:'2026-42-02',sources:[original]}});
 assert.equal(otherAccount.data.items[0].status,'DELIVERED');assert.equal(failedReads,0,'saved exact evidence needs no scan or target week');
 const edited={...original,external_message_id:'new',identity:'nenovakakao|sales|new',message:'다른 추가 1박스'};
 const partial=await restarted({body:{year:'2026',week:'2026-42-02',sources:[original,edited]}});
 assert.equal(partial.code,200);assert.equal(partial.data.items[0].status,'DELIVERED');assert.equal(partial.data.items[1].status,'UNCONFIRMED');assert(partial.data.warning);
 const unconfigured=await harness(()=>{throw Error('no network');},{token:'',store})({body:{year:'2026',week:'2026-42-02',sources:[original,edited]}});
 assert.equal(unconfigured.code,200);assert.equal(unconfigured.data.items[0].status,'DELIVERED');assert(unconfigured.data.warning);
 assert.equal((await restarted({body:{year:'2026',week:'2026-42-02',sources:[{...original,message:original.message+' 편집'}]}})).code,502,'edited exact text cannot reuse saved match');
 const duplicateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-duplicate-'));directories.push(duplicateDirectory);
 const duplicateStore=createDistributionDeliveryEvidenceStore({directory:duplicateDirectory});
 const duplicateHandler=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[delivered],hasMore:false,nextAfterKey:null})}),{store:duplicateStore});
 assert.equal((await duplicateHandler({body:{year:'2026',week:'2026-41-01',sources:[{...original,duplicateOriginal:true}]}})).data.items[0].status,'AMBIGUOUS');
 assert.equal(await duplicateStore.read({source:original,year:'2026'}),null,'cross-batch duplicate flag must prevent new persistence');
 assert.equal((await initial({body:{year:'2026',week:'2026-41-01',sources:[{...original,duplicateOriginal:true}]}})).data.items[0].status,'DELIVERED','existing verified fact is preserved');
 const mismatchDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-mismatch-'));directories.push(mismatchDirectory);
 const mismatchStore=createDistributionDeliveryEvidenceStore({directory:mismatchDirectory});
 const mismatchHandler=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[realTarget],hasMore:false,nextAfterKey:null})}),{store:mismatchStore});
 const mismatchResponse=await mismatchHandler({body:{year:'2026',week:'2026-41-01',sources:[realSource]}});
 assert.equal(mismatchResponse.code,200);
 assert.equal(mismatchResponse.data.items[0].status,'DELIVERED');
 assert.equal(mismatchResponse.data.items[0].reason,'week_corrected');
 assert.equal(mismatchResponse.data.items[0].sourceWeek,'41-01');
 assert.equal(mismatchResponse.data.items[0].targetWeek,'41-02');
 assert.equal(mismatchResponse.data.items[0].deliveryIdentity,'nenovakakao|delivery|two');
 assert.equal(mismatchResponse.data.items[0].deliveredAt,realTarget.created_at);
 assert.equal(mismatchResponse.data.items[0].persisted,true);
 assert.equal((await mismatchStore.read({source:realSource,year:'2026'})).reason,'week_corrected','corrected evidence persists');
 const reloaded=harness(async()=>{throw Error('upstream unavailable');},{store:createDistributionDeliveryEvidenceStore({directory:mismatchDirectory})});
 assert.equal((await reloaded({body:{year:'2026',week:'2026-42-02',sources:[realSource]}})).data.items[0].targetWeek,'41-02','reload preserves correction metadata without feed');
 const collisionDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-correction-collision-'));directories.push(collisionDirectory);
 const collisionStore=createDistributionDeliveryEvidenceStore({directory:collisionDirectory});
 const collision=harness(async()=>({ok:true,json:async()=>({ok:true,messages:[realTarget],hasMore:false,nextAfterKey:null})}),{store:collisionStore});
 assert.equal((await collision({body:{year:'2026',week:'2026-41-01',sources:[{...realSource,duplicateCorrectionOriginal:true}]}})).data.items[0].status,'AMBIGUOUS');
 assert.equal(await collisionStore.read({source:realSource,year:'2026'}),null,'cross-batch correction collision cannot persist');
 console.log('distribution delivery status tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const directory of directories)fs.rmSync(directory,{recursive:true,force:true});});
