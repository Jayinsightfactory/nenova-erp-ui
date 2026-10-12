const assert=require('node:assert/strict');
const {recentSalesPeriod,REFRESH_INTERVAL_MS,HISTORY_REFRESH_INTERVAL_MS}=require('../lib/distributionSalesInboxRefresh');
assert.equal(REFRESH_INTERVAL_MS,30000);
assert.equal(HISTORY_REFRESH_INTERVAL_MS,60000);
const inboxSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../components/orders/DistributionSalesInbox.js'),'utf8');
assert(inboxSource.includes('intervalMs:HISTORY_REFRESH_INTERVAL_MS'),'status/history use tested bounded cadence');
assert(inboxSource.includes('data-testid="sales-inbox-refresh-cadence"'),'cadence remains visible outside folded tools');
assert(inboxSource.includes('void refreshLiveHistory(liveScope,liveBatch,{force:true})'),'post-save history refresh bypasses polling delay');
assert(inboxSource.includes('const liveBatch=displayRows')&&inboxSource.includes('()=>[...rows].reverse()'),'full history coverage is preserved');
const {periodBounds}=require('../lib/distributionSalesInbox');
const {retainRecentSalesRows,assertRecentSalesPeriod}=require('../lib/distributionSalesInboxRefresh');
const retentionNow=new Date('2026-01-01T00:00:00+09:00');
const canonical=(id,time)=>({source:'nenovakakao',identity:`nenovakakao|sales|${id}`,created_at:time,message:id});
const retainedRaw=[canonical('old','2025-12-29T14:59:59Z'),canonical('boundary','2025-12-29T15:00:00Z'),canonical('today','2025-12-31T15:00:00Z'),canonical('future','2026-01-01T15:00:00Z'),canonical('unknown',''),{source:'uploaded-kakao',identity:'upload|old',created_at:'2020-01-01T00:00:00Z'}];
assert.deepEqual(retainRecentSalesRows(retainedRaw,retentionNow),[retainedRaw[1],retainedRaw[2],retainedRaw[4],retainedRaw[5]],'three KST days only; unknown and explicit uploads remain');
assert.doesNotThrow(()=>assertRecentSalesPeriod('2025-12-30','2026-01-01',retentionNow));
assert.throws(()=>assertRecentSalesPeriod('2025-12-29','2026-01-01',retentionNow),/최근 3일/);
assert.throws(()=>assertRecentSalesPeriod('2026-01-01','2026-01-02',retentionNow),/최근 3일/);

for(const [now,from,to] of [
  ['2026-09-15T00:00:00+09:00','2026-09-13','2026-09-15'],
  ['2026-09-14T14:59:59Z','2026-09-12','2026-09-14'],
  ['2026-01-01T00:00:00+09:00','2025-12-30','2026-01-01'],
  ['2028-03-01T00:00:00+09:00','2028-02-28','2028-03-01']
]) {
  assert.deepEqual(recentSalesPeriod(new Date(now)),{from,to});
  assert.doesNotThrow(()=>periodBounds(from,to));
}
const {DEFAULT_MAX_PAGES,isAutoRefreshEligible,isCurrentRefresh,kstCalendarDate,readSalesFeedPage,refreshSalesFeed,shouldBufferIncoming,startBoundedAutoRefresh,validKstPeriod}=require('../lib/distributionSalesInboxRefresh');

assert.equal(kstCalendarDate(new Date('2026-09-10T15:30:00.000Z')),'2026-09-11');
assert.equal(validKstPeriod('2026-09-11/2026-09-11'),true);assert.equal(validKstPeriod('/'),false);assert.equal(validKstPeriod('2026-02-30/2026-03-01'),false);
assert.equal(validKstPeriod('2026-13-01/2026-13-01'),false);
assert.equal(isAutoRefreshEligible({open:true,autoRefresh:true,disabled:false,visible:true,online:true,year:'2025',week:'2026-37-01',period:'2026-09-11/2026-09-11',loadedPeriod:''}),false);
const todayScope={open:true,autoRefresh:true,disabled:false,visible:true,online:true,year:'2026',week:'2026-37-01',period:'2026-09-11/2026-09-11',loadedPeriod:''};
assert.equal(isAutoRefreshEligible(todayScope),true);
assert.equal(isAutoRefreshEligible({...todayScope,visible:false}),false);
assert.equal(isAutoRefreshEligible({...todayScope,online:false}),false);
assert.equal(isAutoRefreshEligible({...todayScope,autoRefresh:false}),false);
assert.equal(isAutoRefreshEligible({...todayScope,disabled:true}),false);
assert.equal(isAutoRefreshEligible({...todayScope,week:'37-01'}),false);
assert.equal(isAutoRefreshEligible({...todayScope,loadedPeriod:'2026-09-10/2026-09-10'}),false);
assert.equal(isCurrentRefresh({sequence:2,currentSequence:2,scope:'today',currentScope:'today'}),true);
assert.equal(isCurrentRefresh({sequence:2,currentSequence:3,scope:'today',currentScope:'today'}),false);
assert.equal(isCurrentRefresh({sequence:2,currentSequence:2,scope:'today',currentScope:'edited'}),false);
assert.equal(shouldBufferIncoming({selectedCount:0,reviewOpen:false}),false);
assert.equal(shouldBufferIncoming({selectedCount:1,reviewOpen:false}),true);
assert.equal(shouldBufferIncoming({selectedCount:0,reviewOpen:true}),true);

(async()=>{
  const {createAppendFeedReader}=require('../lib/distributionSalesInboxRefresh');
  const {mergeMessages}=require('../lib/distributionSalesInbox');
  const readAppend=createAppendFeedReader();
  const requests=[];
  let fail=false;
  const fetchAppend=async url=>{
    const query=new URL(url,'http://localhost').searchParams;
    requests.push(Object.fromEntries(query));
    if(fail)throw Error('offline');
    const next=query.get('afterKey')===''?'page-2':null;
    return {ok:true,json:async()=>({ok:true,messages:[{source:'nenovakakao',chat_id:'sales',external_message_id:next?'old':'new',message:next?'changed old text':'new text'}],hasMore:!!next,nextAfterKey:next})};
  };
  const first=await readAppend({fetchImpl:fetchAppend,maxPages:1,now:new Date('2026-12-31T23:59:00+09:00')});
  assert.equal(first.complete,false);
  fail=true;
  await assert.rejects(readAppend({fetchImpl:fetchAppend,maxPages:1,now:new Date('2026-12-31T23:59:30+09:00')}),/offline/);
  fail=false;
  const second=await readAppend({fetchImpl:fetchAppend,maxPages:1,now:new Date('2026-12-31T23:59:45+09:00')});
  assert.equal(requests[2].afterKey,'page-2','failed reads retain the next page, never restart at 600');
  assert.equal(second.to,'2026-12-31','same-day unfinished scan retains its cursor after failure');
  await readAppend({fetchImpl:fetchAppend,maxPages:1,now:new Date('2027-01-01T00:02:00+09:00')});
  assert.equal(requests[3].to,'2027-01-01','next completed cycle includes the new KST day/year');
  assert.equal(requests[3].afterKey,'');
  await readAppend({fetchImpl:fetchAppend,maxPages:1,now:new Date('2027-01-02T00:01:00+09:00')});
  assert.equal(requests[4].afterKey,'','midnight discards unfinished old-window cursor');
  assert.equal(requests[4].from,'2026-12-31','rolling scan never reads beyond current three days');
  const saved={identity:'nenovakakao|sales|old',message:'saved original',confirmed:true};
  const merged=mergeMessages([saved],[...first.messages,...second.messages]).rows;
  assert.equal(merged.length,2);
  assert.equal(merged.find(row=>row.identity===saved.identity),saved,'existing raw text and evidence are preserved');
  assert(inboxSource.includes('[autoFeedRefresh,setAutoFeedRefresh]=useState(true)'));
  assert(inboxSource.includes('[autoRefresh,setAutoRefresh]=useState(false)'),'ERP polling remains opt-in');
  const appendEffect=inboxSource.slice(inboxSource.indexOf('const readAppend=createAppendFeedReader()'),inboxSource.indexOf('},[open,autoFeedRefresh'));
  assert(!appendEffect.includes('setHistoryAttempted'));
  assert(!appendEffect.includes('setFeedEvidenceRevision'));
  assert(!appendEffect.includes('setFrom(')&&!appendEffect.includes('setTo('),'saved evidence period stays fixed');
  const requested=[];
  const pages=[
    {ok:true,messages:[{source:'nenovakakao',chat_id:'room',external_message_id:'a'}],hasMore:true,nextAfterKey:'a'},
    {ok:true,messages:[{source:'nenovakakao',chat_id:'room',external_message_id:'a'},{source:'nenovakakao',chat_id:'room',external_message_id:'b'}],hasMore:false,nextAfterKey:'b'}
  ];
  const fetchImpl=async url=>{requested.push(String(url));return {ok:true,json:async()=>pages.shift()};};
  const result=await refreshSalesFeed({fetchImpl,from:'2026-09-11',to:'2026-09-11'});
  assert.equal(result.complete,true);assert.equal(result.pages,2);assert.deepEqual(result.messages.map(row=>row.identity),['nenovakakao|room|a','nenovakakao|room|b']);
  assert.equal(new URL(requested[0],'http://local').searchParams.get('afterKey'),'');assert.equal(new URL(requested[1],'http://local').searchParams.get('afterKey'),'a');

  let page=0;
  const capped=await refreshSalesFeed({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,messages:[{source:'nenovakakao',chat_id:'room',external_message_id:`${page++}`}],hasMore:true,nextAfterKey:`${page}`})}),from:'2026-09-11',to:'2026-09-11'});
  assert.equal(capped.complete,false);assert.equal(capped.pages,DEFAULT_MAX_PAGES);
  await assert.rejects(()=>refreshSalesFeed({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,messages:[],hasMore:true,nextAfterKey:''})}),from:'2026-09-11',to:'2026-09-11'}),/다음 조회 위치/);
  await assert.rejects(()=>refreshSalesFeed({fetchImpl:async()=>new Promise((resolve,reject)=>{const error=Object.assign(new Error('aborted'),{name:'AbortError'});setTimeout(()=>reject(error),0);}),from:'2026-09-11',to:'2026-09-11',setTimeoutImpl:fn=>{fn();return 9;},clearTimeoutImpl:()=>{}}),/8초/);

  await assert.rejects(()=>readSalesFeedPage({fetchImpl:async()=>({ok:false,json:async()=>({error:'offline'})}),from:'2026-09-11',to:'2026-09-11'}),/offline/);

  let timer,cleared=false,runs=0,resolveRun;
  const stop=startBoundedAutoRefresh({run:()=>{runs++;return new Promise(resolve=>{resolveRun=resolve;});},setIntervalImpl:fn=>{timer=fn;return 7;},clearIntervalImpl:id=>{cleared=id===7;}});
  assert.equal(runs,1);timer();assert.equal(runs,1);resolveRun();await Promise.resolve();timer();assert.equal(runs,2);stop();assert.equal(cleared,true);
  let retryTimer,retries=0,clock=0;
  const stopRetry=startBoundedAutoRefresh({run:async()=>{retries++;throw new Error('offline');},now:()=>clock,setIntervalImpl:fn=>{retryTimer=fn;return 8;},clearIntervalImpl:()=>{}});
  await Promise.resolve();retryTimer();assert.equal(retries,1);clock=30_000;retryTimer();assert.equal(retries,1);clock=60_000;retryTimer();assert.equal(retries,2);stopRetry();
  let delayedTimer,delayedRuns=0;
  const stopDelayed=startBoundedAutoRefresh({immediate:false,run:async()=>{delayedRuns++;},setIntervalImpl:fn=>{delayedTimer=fn;return 10;},clearIntervalImpl:()=>{}});
  assert.equal(delayedRuns,0);delayedTimer();await Promise.resolve();assert.equal(delayedRuns,1);stopDelayed();
  let historyTick,historyRuns=0,historyClock=0,historyEligible=true,historyRelease;
  const stopHistory=startBoundedAutoRefresh({intervalMs:HISTORY_REFRESH_INTERVAL_MS,maxBackoffMs:240000,now:()=>historyClock,isEligible:()=>historyEligible,
    run:()=>{historyRuns++;return new Promise((resolve,reject)=>{historyRelease={resolve,reject};});},
    setIntervalImpl:(fn,ms)=>{assert.equal(ms,60000);historyTick=fn;return 11;},clearIntervalImpl:()=>{}});
  assert.equal(historyRuns,1,'complete initial history begins immediately');
  historyClock=60000;historyTick();assert.equal(historyRuns,1,'slow history never overlaps');
  historyRelease.reject(Error('offline'));await Promise.resolve();await Promise.resolve();
  historyClock=120000;historyTick();assert.equal(historyRuns,1,'failure backs off');
  historyClock=180000;historyEligible=false;historyTick();assert.equal(historyRuns,1,'hidden/offline blocks retry');
  historyEligible=true;historyTick();assert.equal(historyRuns,2);
  historyRelease.resolve();await Promise.resolve();await Promise.resolve();
  stopHistory();historyTick();assert.equal(historyRuns,2,'cleanup blocks further reads');
  console.log('distribution sales inbox refresh tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
