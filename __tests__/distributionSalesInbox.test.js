const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {periodBounds,parseSalesExport,mergeMessages,selectedText}=require('../lib/distributionSalesInbox');
assert.deepEqual(periodBounds('2026-09-10','2026-09-10'),{from:'2026-09-09T15:00:00.000Z',to:'2026-09-10T15:00:00.000Z'});
assert.throws(()=>periodBounds('2026-02-30','2026-03-01'));
assert.throws(()=>periodBounds('2026-99-30','2026-03-01'),/조회 시작일/);
assert.equal(parseSalesExport('영업방\n--- 2026년 2월 30일 ---\n[직원] [오전 9:00] 추가 요청')[0].timestamp_approximate,true);
assert.throws(()=>periodBounds('2026-09-01','2026-09-10'));
assert.throws(()=>periodBounds('2026-09-10','2026-09-09'));
const rows=parseSalesExport('영업방 님과 카카오톡 대화\n--------------- 2026년 9월 10일 목요일 ---------------\n[직원] [오전 12:05] 37-01 카네이션\n라움\n화이트 1박스 추가\n[직원] [오후 12:06] 1단 취소');
assert.equal(rows.length,2);assert.equal(rows[0].created_at,'2026-09-10T00:05:00+09:00');assert.equal(rows[1].created_at,'2026-09-10T12:06:00+09:00');
assert.match(rows[0].message,/1박스 추가/);
assert.equal(parseSalesExport('[직원] [오전 9:00] 연도 없는 원문')[0].timestamp_approximate,true);
assert.throws(()=>parseSalesExport('형식 없는 일반 문장'));
const a={identity:'a',message:'1박스 추가',created_at:'2026-09-10'},b={identity:'b',message:'1단 취소',created_at:'2026-09-11'};
assert.equal(mergeMessages([a],[a,b]).duplicateCount,1);assert.equal(mergeMessages([a],[a,b]).rows.length,2);
assert.equal(selectedText([a,b],{b:true}),'1단 취소');
const api=fs.readFileSync(require.resolve('../pages/api/kakao/sales-feed.js'),'utf8');
assert.match(api,/withAuth/);assert.match(api,/NENOVA_SALES_READ_TOKEN/);assert.match(api,/r.chat_id!==roomId/);assert.doesNotMatch(api,/googleSheets|\/api\/kakao\/messages/);
assert.match(api,/function validAfterKey/);assert.match(api,/const afterKey=req\.query\.afterKey\?\?''/);assert.match(api,/nextAfterKey/);assert.doesNotMatch(api,/afterId|nextAfterId/);
const ui=fs.readFileSync(require.resolve('../components/orders/DistributionSalesInbox.js'),'utf8');assert.doesNotMatch(ui,/adjust-batch|\/api\/orders\/(?:index|parse-paste)|handleAllMixedDistribute/);
assert.match(ui,/fetch\('\/api\/orders\/distribution-manual-applications',\{method:'POST'/);
const automaticApplicationRead=ui.match(/async function refreshApplicationStatus[\s\S]*?\n  }\n  useEffect/)[0];assert.doesNotMatch(automaticApplicationRead,/method:\s*['"]POST/);
const automaticLiveHistoryRead=ui.match(/async function refreshLiveHistory[\s\S]*?\n  }\n  async function refreshApplicationStatus/)[0];
assert.match(automaticLiveHistoryRead,/fetch\('\/api\/orders\/distribution-live-history',\{method:'POST'/);
assert.match(automaticLiveHistoryRead,/advisoryOnly!==true/);assert.match(automaticLiveHistoryRead,/erpAction!=='NONE'/);
assert.match(automaticLiveHistoryRead,/messages\.slice\(0,50\)\.map/);assert.match(automaticLiveHistoryRead,/liveHistoryScopeEpoch/);assert.match(automaticLiveHistoryRead,/liveHistoryBatchKeyRef/);assert.match(automaticLiveHistoryRead,/12000/);
assert.match(automaticLiveHistoryRead,/data\.scope\.year===String\(year\)/);assert.match(automaticLiveHistoryRead,/data\.scope\.weeks\[0\]===applicationWeek/);assert.match(automaticLiveHistoryRead,/data\.scope\.from===from&&data\.scope\.to===to/);
assert.match(automaticLiveHistoryRead,/completeUniqueIdentitySet/);assert.match(automaticLiveHistoryRead,/Object\.prototype\.hasOwnProperty\.call\(LIVE_HISTORY_LABELS,item\.status\)/);assert.match(automaticLiveHistoryRead,/Array\.isArray\(data\?\.warnings\)/);
assert.doesNotMatch(automaticLiveHistoryRead,/distribution-change-audits|distribution-manual-applications|parse-paste|adjust-batch|llm|openai/i);
assert.match(ui,/Object\.prototype\.hasOwnProperty\.call\(draft,'expectedCurrentEventId'\)/);
assert.match(ui,/수동 적용 저장이 18초 안에 끝나지 않았습니다/);assert.match(ui,/적용 상태 조회가 8초 안에 끝나지 않았습니다/);
assert.match(ui,/applicationScopeEpoch/);assert.match(ui,/applicationSaveInFlight\.current\)\{applicationRefreshQueued/);assert.match(ui,/loaded:false/);
assert.match(ui,/applicationRefreshQueued/);assert.match(ui,/저장된 AI 비교 보고서 \(참고\)/);assert.match(ui,/setApplicationStatus\(previous=>\(\{\.\.\.previous,loading:false\}\)\)/);
assert.match(ui,/const auditEntries=Array\.isArray\(audit\?\.entries\)\?audit\.entries:\[\]/);assert.match(ui,/const auditUnresolved=Array\.isArray\(audit\?\.unresolved\)\?audit\.unresolved:\[\]/);assert.match(ui,/Array\.isArray\(entry\.candidateEvents\)\?entry\.candidateEvents:\[\]/);
assert.match(ui,/priorApplicationController=applicationController\.current;priorApplicationController\?\.abort\(\);if\(applicationController\.current===priorApplicationController\)\{applicationController\.current=null;applicationInFlight\.current=false;setApplicationStatus/);
assert.match(ui,/<style jsx global>/);assert.match(ui,/\.sales-inbox \.live-history-panel\{min-width:0;border:1px solid #bfd4e6/);assert.match(ui,/\.sales-inbox \.live-event-order\{background:#eef5ff\}/);assert.match(ui,/\.sales-inbox \.live-event-shipment\{background:#eff8f1\}/);assert.match(ui,/\.sales-inbox \.application-panel button/);
assert.match(ui,/<div hidden=\{!open\}>/);assert.doesNotMatch(ui,/\{open&&<>/);
const uploadUpdater=ui.match(/setRows\((previous=>mergeMessages\(previous,identified\)\.rows)\)/);
assert.ok(uploadUpdater,'upload must merge against latest committed state');
const delayedUpload=new Function('mergeMessages','identified',`return ${uploadUpdater[1]}`)(mergeMessages,[b]);
assert.deepEqual(delayedUpload([a]).map(row=>row.identity),['a','b'],'auto-received row survives delayed upload completion');
assert.deepEqual(mergeMessages(delayedUpload([]),[a]).rows.map(row=>row.identity),['a','b'],'upload survives later automatic completion');
const refresh=fs.readFileSync(require.resolve('../lib/distributionSalesInboxRefresh'),'utf8');
assert.match(ui,/readSalesFeedPage/);assert.match(ui,/refreshSalesFeed/);assert.match(ui,/startBoundedAutoRefresh/);assert.match(ui,/새 대화 \{pendingRows\.length\}건 보기/);assert.doesNotMatch(ui,/afterId|nextAfterId/);
assert.match(ui,/refreshSeq/);assert.match(ui,/activeRefreshScope/);assert.match(ui,/requestOwner/);assert.match(ui,/자동 확인이 끝난 뒤 다시 시도하세요/);
assert.match(ui,/open,setOpen\]=useState\(true\)/);assert.match(ui,/autoRefresh,setAutoRefresh\]=useState\(true\)/);assert.doesNotMatch(ui,/if\(open\)setAutoRefresh\(true\)/);assert.match(ui,/현재 표시 원문 기간/);assert.match(ui,/입력한 조회 기간/);
assert.match(ui,/입력칸으로/);assert.match(ui,/비교 선택/);assert.match(ui,/검토·비교/);assert.match(ui,/수동 적용함/);assert.match(ui,/미적용 표시/);assert.match(ui,/표시 해제/);assert.match(ui,/실제 등록·분배·취소를 실행하거나 확인하지 않습니다/);assert.match(ui,/data-manual-application-refresh/);assert.match(ui,/data-live-history-refresh/);assert.match(ui,/displayRows\.map/);assert.match(ui,/reviewMounted&&<div>/);assert.match(ui,/message-pair/);assert.match(ui,/live-history-panel/);assert.match(ui,/이번 자동 대조 범위 밖/);assert.match(ui,/이전 50건 대조/);assert.match(ui,/최신 이력 조회 경고/);assert.match(ui,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);assert.match(ui,/ORDER_AND_DISTRIBUTION/);assert.match(ui,/NO_LIVE_EVIDENCE:'대응 이력 미확인'/);assert.match(ui,/저장된 AI 비교 보고서 \(참고\)/);assert.match(ui,/immediate:initialLoad/);assert.match(ui,/loadedPeriod,year,week/);assert.match(ui,/영업방 자동 확인을 기다리는 중입니다/);
assert.match(refresh,/isAutoRefreshEligible/);assert.match(refresh,/isCurrentRefresh/);assert.match(refresh,/shouldBufferIncoming/);assert.match(refresh,/afterKey/);assert.match(refresh,/new URLSearchParams\(\{from,to,afterKey\}\)/);assert.match(refresh,/DEFAULT_MAX_PAGES/);assert.doesNotMatch(refresh,/method:\s*['"]POST/);

function compileSalesFeed(fetchImpl) {
  const transformed=api
    .replace("import { withAuth } from '../../../lib/auth';",'const {withAuth}=deps.auth;')
    .replace("import { periodBounds } from '../../../lib/distributionSalesInbox';",'const {periodBounds}=deps.inbox;')
    .replace('export default withAuth','module.exports=withAuth');
  const module={exports:null};
  vm.runInNewContext(transformed,{module,deps:{auth:{withAuth:handler=>handler},inbox:{periodBounds}},process:{env:{NENOVA_SALES_READ_TOKEN:'test-token',NENOVA_SALES_ROOM_ID:'room-1'}},URL,AbortController,setTimeout:()=>null,clearTimeout:()=>{},fetch:fetchImpl});
  return module.exports;
}
function response() { return {statusCode:200,body:null,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}; }
function upstream(data) { return {ok:true,json:async()=>data}; }

(async()=>{
  let requestedUrl='';
  const handler=compileSalesFeed(async url=>{
    requestedUrl=String(url);
    return upstream({ok:true,messages:[{id:null,chatroom:'영업방',chat_id:'room-1',source:'nenovakakao',external_message_id:'external /?키'}],hasMore:true,nextAfterKey:'next /?키'});
  });
  const ok=response();
  await handler({method:'GET',query:{from:'2026-09-10',to:'2026-09-10',afterKey:'external /?키'}},ok);
  assert.equal(ok.statusCode,200);assert.equal(ok.body.messages[0].id,null);assert.equal(ok.body.nextAfterKey,'next /?키');
  const url=new URL(requestedUrl);assert.equal(url.searchParams.get('afterKey'),'external /?키');assert.equal(url.searchParams.get('afterId'),null);

  let called=false;
  const invalidCursor=response();
  await compileSalesFeed(async()=>{called=true;return upstream({});})({method:'GET',query:{from:'2026-09-10',to:'2026-09-10',afterKey:'bad\nkey'}},invalidCursor);
  assert.equal(invalidCursor.statusCode,400);assert.equal(called,false);

  const invalidNext=response();
  await compileSalesFeed(async()=>upstream({ok:true,messages:[],hasMore:true,nextAfterKey:null}))({method:'GET',query:{from:'2026-09-10',to:'2026-09-10',afterKey:''}},invalidNext);
  assert.equal(invalidNext.statusCode,502);
  console.log('distributionSalesInbox tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
