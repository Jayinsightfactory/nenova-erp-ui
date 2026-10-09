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
