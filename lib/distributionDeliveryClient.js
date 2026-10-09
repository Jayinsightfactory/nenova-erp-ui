const {exactDeliveryTime}=require('./distributionDeliveryStatus');
const SOURCE_FIELDS=['identity','source','chat_id','external_message_id','chatroom','message','created_at','timestamp_approximate','truncated','is_truncated'];
function deliveryRequestBatches(rows,year,week) {
  const batches=[],oversized=[];let batch=[],chars=0;
  const byteLength=sources=>new TextEncoder().encode(JSON.stringify({year,week,sources})).length;
  for(const row of rows){
    const source=Object.fromEntries(SOURCE_FIELDS.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
    if(row.duplicateOriginal===true)source.duplicateOriginal=true;
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
// Retain only verified facts for the exact original. Target-week changes and
// unrelated incoming rows do not invalidate a physical forwarding event.
function createDeliveryEvidenceCache() {
  let owner='',entries=new Map();
  const key=(row,year)=>JSON.stringify([year,...SOURCE_FIELDS.map(field=>row[field]??null)]);
  return {
    read(actorId,year,rows) {
      if(owner!==JSON.stringify([actorId,year]))return {};
      return Object.fromEntries(rows.flatMap(row=>{const item=entries.get(key(row,year));return item?[[row.identity,item]]:[];}));
    },
    accept(actorId,year,rows,items) {
      const nextOwner=JSON.stringify([actorId,year]);
      if(owner!==nextOwner){owner=nextOwner;entries=new Map();}
      for(const row of rows){const item=items[row.identity];if(item?.status==='DELIVERED')entries.set(key(row,year),item);}
      // The durable copy lives on the server; bound browser memory to raw rows.
      const current=new Set(rows.map(row=>key(row,year)));
      for(const entry of entries.keys())if(!current.has(entry))entries.delete(entry);
      return this.read(actorId,year,rows);
    },
  };
}
module.exports={deliveryRequestBatches,validatedDeliveryItems,createDeliveryEvidenceCache};
