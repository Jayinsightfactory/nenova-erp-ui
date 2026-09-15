const assert=require('node:assert/strict');
const {normalizeScope,toFacts,parseMessages,pairRequests}=require('../lib/distributionLiveHistory');
const {buildDistributionRequestBalanceComparison,cloneParsedItems}=require('../lib/distributionRequestBalance');
const {combinedHistoryEvidence}=require('../lib/combinedHistoryEvidence');
const scope=normalizeScope({year:'2026',week:'37-02',from:'2026-09-14',to:'2026-09-15'});
const facts=toFacts({customers:[{CustKey:478,CustName:'왕자원예'}],products:[{ProdKey:53,ProdName:'ALSTROMERIA Whistler',OutUnit:'단',BunchOf1Box:16}],shipmentRows:[{eventId:100582,year:'2026',week:'37-02',custKey:478,prodKey:53,unit:'단',before:48,after:30,changeLocal:'2026-09-15T09:56:15.710',shipmentDateCount:1}]});
const messages=[{identity:'early',message:'37-02\n영림\n휘슬러 2단 취소',created_at:'2026-09-14T00:25:00Z'},{identity:'later',message:'37-02\n영림 : 휘슬러 1박스 취소',created_at:'2026-09-14T00:59:00Z'}];
const parsed=parseMessages(messages,facts,{customers:{영림원예:{custKey:478}}},scope);
assert.deepEqual(parsed.map(i=>[i.requests[0].custKey,i.requests[0].prodKey,i.requests[0].qty]),[[478,53,2],[478,53,16]]);
const comparison=buildDistributionRequestBalanceComparison({parsedItems:cloneParsedItems(parsed),facts,balanceFacts:{},scope});
assert.equal(comparison.products[0].observedSignedDelta,-18);
assert.ok(comparison.products[0].requests.every(r=>r.evidenceStatus==='CONSISTENT'));
assert.ok(pairRequests(parsed,facts,scope).every(i=>i.requests[0].status==='DISTRIBUTION_EVIDENCE'));
const requests=parseMessages(messages,facts,{customers:{영림원예:{custKey:478}}},scope).flatMap(i=>i.requests);
assert.equal(combinedHistoryEvidence(requests,facts.shipmentEvents,scope).size,2);
assert.equal(combinedHistoryEvidence(requests,facts.shipmentEvents,scope,true).size,0);
assert.equal(combinedHistoryEvidence(requests,[...facts.shipmentEvents,{...facts.shipmentEvents[0],eventId:2}],scope).size,0);
assert.equal(combinedHistoryEvidence(requests,[{...facts.shipmentEvents[0],year:'2025'}],scope).size,0);
assert.equal(combinedHistoryEvidence(requests,[{...facts.shipmentEvents[0],after:31}],scope).size,0);
assert.equal(combinedHistoryEvidence(requests,[{...facts.shipmentEvents[0],multiDate:true}],scope).size,0);
assert.equal(combinedHistoryEvidence([requests[0],{...requests[1],action:'ADD'}],facts.shipmentEvents,scope).size,0);
const collision=parseMessages(messages,{...facts,customers:[...facts.customers,{CustKey:479,CustName:'다른업체'}]},{customers:{영림원예:{custKey:478},영림:{custKey:479}}},scope);
assert.equal(collision[0].requests[0].status,'AMBIGUOUS');
console.log('saved customer alias and 2+16=18 native aggregate evidence: positive and safety cases passed');
{
 const later=requests.map((r,i)=>({...r,id:'second-'+i,sourceAt:`2026-09-15T10:0${i}:00+09:00`,qty:1}));
 const events=[...facts.shipmentEvents,{...facts.shipmentEvents[0],eventId:100583,before:30,after:28,changeAt:'2026-09-15T11:00:00+09:00'}];
 assert.equal(combinedHistoryEvidence([...requests,...later],events,scope).size,4,'separate native event windows can each match their full request sum');
 assert.equal(combinedHistoryEvidence([...requests,...later],events.map(e=>({...e,after:e.after-1})),scope).size,0,'never search subsets to manufacture matching sums');
}
{
 const {groupHistoryReposts,expandHistoryReposts}=require('../lib/historyReposts');
 const original={identity:'feed|room|a',message:'37-02\n왕자\n휘슬러 2단 취소',created_at:'2026-09-14T09:00:00+09:00'};
 const copy={...original,identity:'feed|room|b',message:original.message+'\n메시지가 삭제되었습니다.',created_at:'2026-09-14T09:01:00+09:00'};
 const groups=groupHistoryReposts([copy,original]);assert.equal(groups.length,1);assert.equal(groups[0].message.identity,original.identity);
 assert.equal(groupHistoryReposts([original,{...copy,created_at:'2026-09-14T10:00:00+09:00'}]).length,2);
 assert.equal(groupHistoryReposts([original,{...copy,identity:'feed|other|b'}]).length,2);
 assert.equal(groupHistoryReposts([original,{...copy,message:original.message,created_at:'2026-09-14T09:01:00+09:00'}]).length,2,'ordinary repeated instructions without repost evidence remain distinct');
 const expanded=expandHistoryReposts(groups,[{sourceIdentity:original.identity,requests:[{id:original.identity+':1'}]}],{products:[{requestedSignedDelta:-2,requests:[{sourceIdentity:original.identity,requestId:original.identity+':1'}]}]});
 assert.equal(expanded.items.length,2);assert.equal(expanded.items[1].requests[0].id,copy.identity+':1');
 assert.equal(expanded.balanceComparison.products[0].requestedSignedDelta,-2);assert.equal(expanded.balanceComparison.products[0].requests.length,2);
}
const inlineUnknown=parseMessages([{...messages[1],message:'37-02\n영림 : 휘슬러 1박스 취소\n미등록업체 : 휘슬러 2단 추가'}],facts,{customers:{영림원예:{custKey:478}}},scope);
assert.equal(inlineUnknown[0].requests[1].custKey,undefined);
assert.equal(inlineUnknown[0].requests[1].status,'AMBIGUOUS');
