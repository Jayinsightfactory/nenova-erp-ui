'use strict';

function groupSalesHistoryMessages(messages, year, selectedWeek) {
  const groups=new Map();
  for(const message of messages) {
    const scopes=[...String(message.message||'').matchAll(/(?:^|\s)(?:(20\d{2})-)?(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$|[.,:차])/g)]
      .map(match=>({year:match[1]||String(year),week:`${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`}));
    const unique=[...new Set(scopes.map(scope=>`${scope.year}/${scope.week}`))];
    // Do not infer a different year, or select one scope from a mixed message.
    const week=unique.length===1&&scopes[0].year===String(year)?scopes[0].week:selectedWeek;
    if(!groups.has(week))groups.set(week,[]);
    groups.get(week).push(message);
  }
  return [...groups].map(([week,messages])=>({week,messages}));
}

async function readScopedSalesHistory(body,read,validateComparison) {
  const results=[];
  // Sequential scopes keep DB load bounded; requests sharing a scope compete together.
  for(const group of groupSalesHistoryMessages(body.messages,body.year,body.week)) {
    const {response,data}=await read({...body,...group});
    if(!response.ok||data.success!==true)return {response,data};
    const expected=new Set(group.messages.map(row=>row.identity));
    const returned=new Set(data.items?.map(row=>row.sourceIdentity));
    if(data.erpAction!=='NONE'||data.advisoryOnly!==true||data.scope?.year!==String(body.year)||data.scope?.weeks?.length!==1||data.scope.weeks[0]!==group.week||data.scope.from!==body.from||data.scope.to!==body.to||!Array.isArray(data.items)||returned.size!==data.items.length||returned.size!==expected.size||![...expected].every(id=>returned.has(id))||!Array.isArray(data.warnings)||!validateComparison(data.balanceComparison))throw Error('원문 차수별 전산 이력 응답 범위가 일치하지 않습니다.');
    results.push(data);
  }
  if(!results.length)throw Error('대조할 원문이 없습니다.');
  return {response:{ok:true},data:{...results[0],scope:{...results[0].scope,weeks:[body.week]},items:results.flatMap(data=>data.items),warnings:results.flatMap(data=>data.warnings),balanceComparison:{products:results.flatMap(data=>data.balanceComparison?.products||[])},asOf:results.map(data=>data.asOf).sort()[0]}};
}
module.exports={groupSalesHistoryMessages,readScopedSalesHistory};
