const assert=require('node:assert/strict');
const {deliveryRequestBatches,validatedDeliveryItems}=require('../lib/distributionDeliveryClient');
const year='2026',week='2026-41-01';
const row={identity:'nenovakakao|sales|one',source:'nenovakakao',chat_id:'sales',external_message_id:'one',chatroom:'영업방',message:'가'.repeat(19000),created_at:'2026-10-09T10:00:00+09:00',privateExtra:'omit'};
const rows=Array.from({length:220},(_,i)=>({...row,identity:`nenovakakao|sales|${i}`}));
const {batches,oversized}=deliveryRequestBatches([...rows,{...row,identity:'oversized',message:'x'.repeat(20001)}],year,week);
assert.equal(oversized.length,1);assert.equal(batches.flat().length,220);
for(const sources of batches){assert(sources.length<=200);assert(sources.reduce((sum,row)=>sum+row.message.length,0)<=200000);assert(Buffer.byteLength(JSON.stringify({year,week,sources}))<=450000);assert(!('privateExtra' in sources[0]));}
const item={identity:row.identity,status:'DELIVERED',deliveredAt:'2026-10-09T10:01:00+09:00',deliveryIdentity:'nenovakakao|delivery|two'};
const good={ok:true,year,week,items:[item]};
assert.equal(validatedDeliveryItems(good,[row],year,week)[0].status,'DELIVERED');
for(const bad of [{...good,year:'2025'},{...good,week:'2026-40-01'},{...good,items:[]},{...good,items:[item,item]},{...good,items:[{...item,deliveredAt:''}]},{...good,items:[{...item,deliveryIdentity:row.identity}]},{...good,items:[{...item,deliveredAt:'2025-10-09T10:01:00+09:00'}]}])assert.throws(()=>validatedDeliveryItems(bad,[row],year,week));
console.log('delivery client: bounded UTF8 batches, oversize isolation, whitelist, complete scoped evidence passed');

for(const flag of ['truncated','is_truncated']) {
 const request=deliveryRequestBatches([{...row,[flag]:true}],year,week).batches[0][0];
 assert.equal(request[flag],true);
 const result=require('../lib/distributionDeliveryStatus').matchDeliveryStatus({sources:[request],targets:[{...request,[flag]:false,chat_id:'target',external_message_id:'two',chatroom:'현장 추가취소방',created_at:'2026-10-09T10:01:00+09:00'}],year});
 assert.equal(result[0].status,'UNCONFIRMED');assert.equal(result[0].reason,'incomplete');
}

// Render the real hook with controlled React state: unchanged evidence can
// survive an appended row, but never a new actor, year, raw text or error.
const fs=require('node:fs'),vm=require('node:vm');
let hookState={scope:'',items:{},loading:false,error:''},effects=[];
const source=fs.readFileSync(require.resolve('../components/orders/useDistributionDeliveryStatus'),'utf8').replace(/^import .*;$/gm,'').replace('export default function','function');
const context={useState:()=>[hookState,next=>{hookState=typeof next==='function'?next(hookState):next;}],useEffect:fn=>effects.push(fn),JSON,Object,Map,Set,document:{visibilityState:'visible'},navigator:{onLine:true},console};
vm.runInNewContext(source+';this.hook=useDistributionDeliveryStatus;',context);
const args={rows:[row],year,week,enabled:true,actorId:'a'};
assert.equal(context.hook(args).pending,true);
const fingerprint=JSON.stringify([row.message,row.created_at,row.timestamp_approximate,row.source,row.chatroom,row.chat_id,row.external_message_id,row.truncated,row.is_truncated]);
hookState={scope:'prior',ownerScope:JSON.stringify(['a',year,week]),fingerprints:{[row.identity]:fingerprint},items:{[row.identity]:item},loading:false,error:''};
assert.equal(context.hook({...args,rows:[row,{...row,identity:'new',message:'distinct raw message'}]}).items[row.identity].status,'DELIVERED');
assert.equal(Object.keys(context.hook({...args,rows:[row,{...row,identity:'duplicate',message:'  '+row.message+'\n'}]}).items).length,0,'new normalized duplicate must immediately remove retained green, even offline');
assert.equal(Object.keys(context.hook({...args,actorId:'b'}).items).length,0);
assert.equal(Object.keys(context.hook({...args,year:'2025'}).items).length,0);
assert.equal(Object.keys(context.hook({...args,rows:[{...row,message:'changed'}]}).items).length,0);
hookState={...hookState,items:{},error:'failed'};
assert.equal(Object.keys(context.hook(args).items).length,0);
console.log('delivery hook: initial waiting and exact owner/raw evidence retention passed');
