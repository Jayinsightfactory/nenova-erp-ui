'use strict';
// One unique native event can represent the sum of distinct, same-direction
// requests. Never search subsets or rewrite the native before/after values.
function combinedHistoryEvidence(requests,events,scope,truncated=false) {
  const output=new Map();if(truncated)return output;
  const groups=new Map();
  for(const r of requests) {
    if(r.status==='AMBIGUOUS'||r.unitComparisonMode==='NUMERIC_ONLY'||r.timestamp_approximate||!Number.isFinite(Date.parse(r.sourceAt))||String(r.year)!==scope.year||r.week!==scope.weeks[0]||!r.custKey||!r.prodKey||!(r.qty>0)||!['ADD','CANCEL'].includes(r.action))continue;
    const key=[r.year,r.week,r.custKey,r.prodKey,r.unit].join('|');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
  }
  for(const group of groups.values()) {
    if(group.length<2||new Set(group.map(r=>r.id)).size!==group.length)continue;
    // Repeated identical requests may be reposts, not an additive operation.
    if(new Set(group.map(r=>`${r.sourceAt}|${r.qty}`)).size!==group.length)continue;
    const r=group[0],start=Math.min(...group.map(r=>Date.parse(r.sourceAt)));
    const candidates=events.filter(e=>String(e.year)===scope.year&&e.week===r.week&&Number(e.custKey)===Number(r.custKey)&&Number(e.prodKey)===Number(r.prodKey)&&e.unit===r.unit&&Date.parse(e.changeAt)>=start).sort((a,b)=>Date.parse(a.changeAt)-Date.parse(b.changeAt));
    // Native event boundaries, not arbitrary subsets, determine each batch.
    let previous=-Infinity;
    for(const event of candidates) {
      const at=Date.parse(event.changeAt);
      const batch=group.filter(request=>Date.parse(request.sourceAt)>previous&&Date.parse(request.sourceAt)<=at);
      previous=at;
      if(candidates.filter(e=>Date.parse(e.changeAt)===at).length!==1||batch.length<2||new Set(batch.map(r=>r.action)).size!==1)continue;
      const sum=batch.reduce((n,r)=>n+(r.action==='ADD'?r.qty:-r.qty),0);
      if(event.multiDate||!Number.isFinite(event.before)||!Number.isFinite(event.after)||Math.abs(event.after-event.before-sum)>1e-6)continue;
      for(const request of batch)output.set(request.id,{event,sum,count:batch.length});
    }
  }
  return output;
}
module.exports={combinedHistoryEvidence};
