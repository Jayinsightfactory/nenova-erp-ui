// Read-only excerpts; never turn chat text into an ERP mutation.
const action = /추가(?!\s*(?:분|취소방))|취소(?!\s*(?:분|방|하면서|완료|된))/g;
const quantity = /\d+(?:\.\d+)?\s*(?:박스|단|송이|스팀|box\b|st\b|추가|취소)/i;
function requestExcerpt(value) {
  const sections=[];let lines=[],blocked=false;
  const flush=()=>{if(lines.length)sections.push(lines.join('\n'));lines=[];};
  for(const raw of String(value||'').replace(/\r\n?/g,'\n').split('\n')) {
    const line=raw.trim().replace(/\s*(?:->|→).*?(?:출고|배차).*$/,'');if(!line)continue;
    if(/잔량|출고일|출고요일|재고현황/.test(line)) {flush();blocked=true;continue;}
    if(/^[-=*\s]{4,}$/.test(line)){flush();blocked=false;continue;}
    const kinds=[...line.matchAll(action)].map(m=>m[0]);
    const heading=/변경사항|^\s*\*?\d{1,2}(?:-\d{1,2}|차)\s+.*(?:추가|취소)/.test(line);
    if(heading){flush();blocked=false;}
    if(blocked)continue;
    if(/메시지가 삭제|^\s*(?:[-=*>]+\s*)?(?:오늘|내일|월요일|화요일|수요일|목요일|금요일|토요일|일요일).*출고|출고완료|추가\/취소방|추가취소방/.test(line)&&!kinds.length)continue;
    lines.push(line);
  }
  flush();
  const selected=sections.filter(s=>quantity.test(s)&&[...s.matchAll(action)].length);
  const text=selected.join('\n\n');
  return {text,kinds:[...new Set([...text.matchAll(action)].map(m=>m[0]))]};
}
function requestRows(messages) {
  const byId=new Map();
  for(const m of messages||[]) {
    const excerpt=requestExcerpt(m.message);
    if(!excerpt.text)continue;
    const id=`${m.source}|${m.chat_id}|${m.external_message_id}`;
    const timestamp=Date.parse(m.created_at);
    if(!Number.isFinite(timestamp))continue;
    byId.set(id,{...excerpt,id,timestamp,room:m.chatroom,sender:m.sender,time:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp))});
  }
  return [...byId.values()].sort((a,b)=>b.timestamp-a.timestamp||b.id.localeCompare(a.id,'en'));
}
module.exports={requestExcerpt,requestRows};
