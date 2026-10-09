const {exactDeliveryTime}=require('./distributionDeliveryStatus');
const SOURCE_FIELDS=['identity','source','chat_id','external_message_id','chatroom','message','created_at','timestamp_approximate'];
function deliveryRequestBatches(rows,year,week) {
  const batches=[],oversized=[];let batch=[],chars=0;
  const byteLength=sources=>new TextEncoder().encode(JSON.stringify({year,week,sources})).length;
  for(const row of rows){
    const source=Object.fromEntries(SOURCE_FIELDS.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
    const length=typeof source.message==='string'?source.message.length:0;
    if(!length||length>20000||byteLength([source])>450000){oversized.push(source);continue;}
    if(batch.length&&(batch.length>=200||chars+length>200000||byteLength([...batch,source])>450000)){batches.push(batch);batch=[];chars=0;}
    batch.push(source);chars+=length;
  }
  if(batch.length)batches.push(batch);
  return {batches,oversized};
}
function validatedDeliveryItems(data,sources,year,week){
  const expected=new Set(sources.map(row=>row.identity)),seen=new Set();
  if(data.ok!==true||data.year!==year||data.week!==week||!Array.isArray(data.items)||data.items.length!==expected.size)throw new Error('전달 확인 응답 범위를 확인하세요.');
  for(const item of data.items){
    if(!item||!expected.has(item.identity)||seen.has(item.identity)||!['DELIVERED','UNCONFIRMED','AMBIGUOUS'].includes(item.status))throw new Error('전달 확인 응답을 확인하세요.');
    seen.add(item.identity);
    if(item.status==='DELIVERED'){
      const source=sources.find(row=>row.identity===item.identity),at=exactDeliveryTime(source,year),deliveredAt=exactDeliveryTime({created_at:item.deliveredAt},year);
      if(typeof item.deliveryIdentity!=='string'||!/^nenovakakao\|[^|]+\|[^|]+$/.test(item.deliveryIdentity)||item.deliveryIdentity===item.identity||at===null||deliveredAt===null||deliveredAt<at)throw new Error('전달 완료 근거를 확인하세요.');
    }
  }
  return data.items;
}
module.exports={deliveryRequestBatches,validatedDeliveryItems};
