// The sales feed is evidence only. Refreshing it must never trigger analysis or ERP work.
const REFRESH_INTERVAL_MS=15_000;
const DEFAULT_MAX_PAGES=3;

function kstCalendarDate(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=type=>parts.find(part=>part.type===type)?.value||'';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function messageIdentity(message) {
  return `${message.source}|${message.chat_id}|${message.external_message_id}`;
}

function validInboxScope(year,week) {
  return /^\d{4}$/.test(String(year||''))&&new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(String(week||''));
}

function validKstPeriod(period) {
  const parts=String(period||'').split('/');
  if(parts.length!==2||!parts[0]||!parts[1]) return false;
  return parts.every(value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  });
}

function isAutoRefreshEligible({open,autoRefresh,disabled,visible,online,year,week,period,loadedPeriod}) {
  if(!open||!autoRefresh||disabled||visible!==true||online!==true||!validInboxScope(year,week)||!validKstPeriod(period)) return false;
  return loadedPeriod===''||loadedPeriod===period;
}

function isCurrentRefresh({sequence,currentSequence,scope,currentScope}) {
  return sequence===currentSequence&&scope===currentScope;
}

function shouldBufferIncoming({selectedCount,reviewOpen}) {
  return Number(selectedCount)>0||reviewOpen===true;
}

async function readSalesFeedPage({fetchImpl=fetch,from,to,afterKey='',signal}) {
  const query=new URLSearchParams({from,to,afterKey});
  const response=await fetchImpl(`/api/kakao/sales-feed?${query}`,{signal});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.error||'영업방 대화를 확인하지 못했습니다. 기존 목록은 유지됩니다.');
  if(data?.ok!==true||!Array.isArray(data.messages)||data.messages.length>200||typeof data.hasMore!=='boolean'||(data.nextAfterKey!==null&&typeof data.nextAfterKey!=='string')) throw new Error('영업방 응답 형식이 올바르지 않습니다. 기존 목록은 유지됩니다.');
  return data;
}

async function refreshSalesFeed({fetchImpl=fetch,from,to,maxPages=DEFAULT_MAX_PAGES,signal,timeoutMs=8_000,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}) {
  const messages=[];const identities=new Set(),cursors=new Set();let afterKey='';
  for(let page=0;page<maxPages;page++) {
    const controller=new AbortController();let timedOut=false;
    const timer=setTimeoutImpl(()=>{timedOut=true;controller.abort();},timeoutMs);
    const abortFromParent=()=>controller.abort();
    if(signal?.aborted) abortFromParent();
    else signal?.addEventListener?.('abort',abortFromParent,{once:true});
    let data;
    try {data=await readSalesFeedPage({fetchImpl,from,to,afterKey,signal:controller.signal});}
    catch(error) {if(timedOut) throw new Error('영업방 자동 확인이 8초 안에 응답하지 않았습니다. 기존 목록은 유지됩니다.');throw error;}
    finally {clearTimeoutImpl(timer);signal?.removeEventListener?.('abort',abortFromParent);}
    for(const message of data.messages) {
      if(!message?.source||!message?.chat_id||!message?.external_message_id) throw new Error('영업방 메시지 식별값이 올바르지 않습니다. 기존 목록은 유지됩니다.');
      const identity=messageIdentity(message);
      if(!identities.has(identity)) {identities.add(identity);messages.push({...message,identity});}
    }
    if(!data.hasMore) return {messages,complete:true,pages:page+1,nextAfterKey:data.nextAfterKey??''};
    if(!data.nextAfterKey) throw new Error('영업방 다음 조회 위치가 올바르지 않습니다. 기존 목록은 유지됩니다.');
    if(data.nextAfterKey===afterKey||cursors.has(data.nextAfterKey)) throw new Error('영업방 페이지 위치가 반복되어 최신 여부를 확인하지 못했습니다. 기존 목록은 유지됩니다.');
    cursors.add(data.nextAfterKey);
    afterKey=data.nextAfterKey;
  }
  return {messages,complete:false,pages:maxPages,nextAfterKey:afterKey};
}

function startBoundedAutoRefresh({run,isEligible=()=>true,immediate=true,intervalMs=REFRESH_INTERVAL_MS,maxBackoffMs=60_000,now=()=>Date.now(),setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}) {
  let stopped=false,running=false,failures=0,nextAllowedAt=0;
  async function tick() {
    if(stopped||running||now()<nextAllowedAt||!isEligible()) return;
    running=true;
    try {await run();failures=0;nextAllowedAt=0;}
    catch {failures++;nextAllowedAt=now()+Math.min(maxBackoffMs,intervalMs*(2**failures));}
    finally {running=false;}
  }
  if(immediate) void tick();
  const timer=setIntervalImpl(()=>{void tick();},intervalMs);
  return ()=>{stopped=true;clearIntervalImpl(timer);};
}

module.exports={REFRESH_INTERVAL_MS,DEFAULT_MAX_PAGES,kstCalendarDate,messageIdentity,validInboxScope,validKstPeriod,isAutoRefreshEligible,isCurrentRefresh,shouldBufferIncoming,readSalesFeedPage,refreshSalesFeed,startBoundedAutoRefresh};
