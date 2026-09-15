'use strict';

function groupHistoryReposts(messages) {
  const groups=[];
  for(const message of [...messages].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))) {
    const time=Date.parse(message.created_at);
    const text=String(message.message||'').replace(/메시지가\s*삭제되었습니다\.?/g,'').split(/\r?\n/).map(line=>line.trim().replace(/\s+/g,' ')).filter(Boolean).join('\n');
    const tombstone=/메시지가\s*삭제되었습니다/.test(message.message);
    const room=String(message.identity).split('|').slice(0,-1).join('|');
    const group=groups.find(g=>text&&g.text===text&&g.room===room&&Number.isFinite(time)&&!message.timestamp_approximate&&!g.message.timestamp_approximate&&time-g.time<=300000&&(tombstone||g.tombstone||time===g.time));
    if(group)group.copies.push(message);
    else groups.push({message,time,text,tombstone,room,copies:[]});
  }
  return groups;
}

function expandHistoryReposts(groups,items,comparison) {
  const aliases=new Map(groups.map(g=>[g.message.identity,g.copies.map(m=>m.identity)]));
  const replaceId=(id,original,copy)=>typeof id==='string'&&id.startsWith(original+':')?copy+id.slice(original.length):id;
  const expanded=items.flatMap(item=>[item,...(aliases.get(item.sourceIdentity)||[]).map(identity=>({...item,sourceIdentity:identity,repostOf:item.sourceIdentity,requests:item.requests.map(r=>({...r,id:replaceId(r.id,item.sourceIdentity,identity),reason:`동일 원문 재전송 이력 공유 · ${r.reason||''}`}))}))]);
  const balanceComparison=comparison?{...comparison,products:comparison.products.map(product=>({...product,requests:product.requests.flatMap(r=>[r,...(aliases.get(r.sourceIdentity)||[]).map(identity=>({...r,sourceIdentity:identity,requestId:replaceId(r.requestId,r.sourceIdentity,identity),repostOf:r.sourceIdentity}))])}))}:comparison;
  return {items:expanded,balanceComparison};
}
module.exports={groupHistoryReposts,expandHistoryReposts};
