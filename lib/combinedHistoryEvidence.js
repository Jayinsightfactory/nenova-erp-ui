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
    if(group.length<2||new Set(group.map(r=>r.id)).size!==group.length||new Set(group.map(r=>r.action)).size!==1)continue;
    // Repeated identical requests may be reposts, not an additive operation.
    if(new Set(group.map(r=>`${r.sourceAt}|${r.qty}`)).size!==group.length)continue;
    const r=group[0],start=Math.min(...group.map(r=>Date.parse(r.sourceAt))),end=Math.max(...group.map(r=>Date.parse(r.sourceAt)));
    const candidates=events.filter(e=>String(e.year)===scope.year&&e.week===r.week&&Number(e.custKey)===Number(r.custKey)&&Number(e.prodKey)===Number(r.prodKey)&&e.unit===r.unit&&Date.parse(e.changeAt)>=start);
    if(candidates.length!==1)continue;
    const event=candidates[0],sum=group.reduce((n,r)=>n+(r.action==='ADD'?r.qty:-r.qty),0);
    if(event.multiDate||Date.parse(event.changeAt)<end||!Number.isFinite(event.before)||!Number.isFinite(event.after)||Math.abs(event.after-event.before-sum)>1e-6)continue;
    for(const request of group)output.set(request.id,{event,sum,count:group.length});
  }
  return output;
}
module.exports={combinedHistoryEvidence};
