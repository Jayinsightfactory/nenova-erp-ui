const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
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
function harness(fetchImpl,{token='test-token'}={}){
 const source=fs.readFileSync(require.resolve('../pages/api/kakao/delivery-status.js'),'utf8')
  .replace("import { withAuth } from '../../../lib/auth';",'const {withAuth}=deps;')
  .replace("import { periodBounds } from '../../../lib/distributionSalesInbox';",'const {periodBounds}=deps;')
  .replace("import { recentSalesPeriod } from '../../../lib/distributionSalesInboxRefresh';",'const {recentSalesPeriod}=deps;')
  .replace("import { DELIVERY_ROOM, deliveryIdentity, matchDeliveryStatus } from '../../../lib/distributionDeliveryStatus';",'const {DELIVERY_ROOM,deliveryIdentity,matchDeliveryStatus}=deps;')
  .replace('export default withAuth','module.exports=withAuth').replace('export const config=','const config=');
 const context={module:{exports:{}},deps:{...helpers,periodBounds:require('../lib/distributionSalesInbox').periodBounds,recentSalesPeriod:()=>({from:'2026-10-03',to:'2026-10-09'}),withAuth:handler=>(req,res)=>req.user?handler(req,res):res.status(401).json({error:'unauthenticated'})},fetch:fetchImpl,process:{env:{NENOVA_SALES_READ_TOKEN:token}},URL,Date,AbortController,setTimeout,clearTimeout};
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
 console.log('distribution delivery status tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
