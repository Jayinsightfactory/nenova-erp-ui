const assert=require('node:assert/strict');
const {DEFAULT_MAX_PAGES,kstCalendarDate,readSalesFeedPage,refreshSalesFeed,startBoundedAutoRefresh}=require('../lib/distributionSalesInboxRefresh');

assert.equal(kstCalendarDate(new Date('2026-09-10T15:30:00.000Z')),'2026-09-11');

(async()=>{
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
  await Promise.resolve();retryTimer();assert.equal(retries,1);clock=30_000;retryTimer();assert.equal(retries,2);stopRetry();
  console.log('distribution sales inbox refresh tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
