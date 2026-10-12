const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const client=require('../lib/distributionDeliveryClient');
const refreshLib=require('../lib/distributionSalesInboxRefresh');

// Execute the real hook without a DOM/React test dependency. Effects are committed
// after render, and network promises remain controllable to exercise stale work.
function harness(initial) {
  const slots=[],effects=[],pending=[],requests=[],intervals=new Map(),timeouts=new Map();
  const listeners={document:new Map(),window:new Map()};
  let cursor=0,dirty=false,props=initial,value,id=0;
  const surface=name=>({addEventListener:(event,fn)=>listeners[name].set(event,fn),removeEventListener:(event,fn)=>{if(listeners[name].get(event)===fn)listeners[name].delete(event);}});
  const document={...surface('document'),visibilityState:'visible'};
  const navigator={onLine:true};
  const context={...client,document,navigator,window:surface('window'),AbortController,Date,Map,JSON,String,Number,
    HISTORY_REFRESH_INTERVAL_MS:refreshLib.HISTORY_REFRESH_INTERVAL_MS,
    useState(initialValue){const index=cursor++;if(!(index in slots))slots[index]=initialValue;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;dirty=true;}];},
    useRef(initialValue){const index=cursor++;if(!(index in slots))slots[index]={current:initialValue};return slots[index];},
    useEffect(fn,deps){const index=cursor++,previous=effects[index];if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i])))pending.push(()=>{previous?.cleanup?.();effects[index]={deps,cleanup:fn()};});},
    setTimeout(fn,ms){const key=++id;timeouts.set(key,{fn,ms});return key;},clearTimeout(key){timeouts.delete(key);},
    fetch(url,options){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({url,options,resolve,reject});return promise;},
  };
  context.startBoundedAutoRefresh=options=>refreshLib.startBoundedAutoRefresh({...options,setIntervalImpl(fn,ms){const key=++id;intervals.set(key,{fn,ms});return key;},clearIntervalImpl(key){intervals.delete(key);}});
  const source=fs.readFileSync(path.join(__dirname,'../components/orders/useDistributionDeliveryStatus.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
  vm.runInNewContext(`${source}\nthis.hook=useDistributionDeliveryStatus;`,context);
  function render(next=props){props=next;cursor=0;dirty=false;value=context.hook(props);while(pending.length)pending.shift()();return value;}
  async function settle(){for(let i=0;i<12;i++){await Promise.resolve();if(dirty)render();}return value;}
  function respond(index,{error,items}={}){const request=requests[index];if(error)request.reject(new Error(error));else {const body=JSON.parse(request.options.body);request.resolve({ok:true,json:async()=>({ok:true,year:body.year,week:body.week,items:items||body.sources.map(row=>({identity:row.identity,status:'UNCONFIRMED',reason:'not-found'}))})});}}
  render();
  return {requests,intervals,listeners,document,navigator,render,settle,respond,get value(){return value;},unmount(){effects.forEach(effect=>effect?.cleanup?.());},emit(name,event){listeners[name].get(event)?.();}};
}
const row={identity:'nenovakakao|sales|one',source:'nenovakakao',chat_id:'sales',external_message_id:'one',chatroom:'영업방',message:'화이트 1박스 추가',created_at:'2026-10-09T10:00:00+09:00'};
const props={rows:[row],year:'2026',week:'2026-41-01',enabled:true,actorId:'tester'};
(async()=>{
  const h=harness(props);
  await h.settle();
  assert.equal(h.requests.length,1);
  assert.deepEqual([...h.intervals.values()].map(timer=>timer.ms),[60000],'delivery polling remains once per minute');
  h.value.refresh();await h.settle();
  assert.equal(h.requests.length,1,'manual lookup does not overlap an in-flight lookup');
  h.respond(0);await h.settle();
  assert.ok(Number.isFinite(Date.parse(h.value.checkedAt)),'successful lookup exposes checked time');
  h.value.refresh();await h.settle();
  assert.equal(h.requests.length,2,'manual refresh performs a new network lookup');
  h.respond(1,{error:'offline'});await h.settle();
  assert.equal(h.value.error,'offline');
  assert.equal(h.value.checkedAt,undefined,'failure cannot claim a new successful checked time');
  h.document.visibilityState='hidden';h.emit('document','visibilitychange');await h.settle();
  assert.equal(h.requests.length,2);
  h.document.visibilityState='visible';h.emit('document','visibilitychange');await h.settle();
  assert.equal(h.requests.length,3,'visibility recovery triggers immediate lookup');
  h.respond(2);await h.settle();
  h.navigator.onLine=false;h.emit('window','online');await h.settle();assert.equal(h.requests.length,3);
  h.navigator.onLine=true;h.emit('window','online');await h.settle();assert.equal(h.requests.length,4,'online recovery triggers immediate lookup');
  const oldSignal=h.requests[3].options.signal;
  h.render({...props,week:'2026-42-01'});await h.settle();
  assert.equal(oldSignal.aborted,true,'scope switch aborts old request');
  assert.equal(h.requests.length,5);
  h.respond(3,{items:[{identity:row.identity,status:'DELIVERED',deliveryIdentity:'nenovakakao|delivery|two',deliveredAt:'2026-10-09T10:01:00+09:00'}]});await h.settle();
  assert.notEqual(h.value.items[row.identity]?.status,'DELIVERED','late old-scope result cannot update new state or cache');
  h.respond(4);await h.settle();
  assert.equal(h.value.loading,false);
  assert.ok(h.requests.every(request=>request.url==='/api/kakao/delivery-status'),'refresh never invokes analysis or ERP write endpoints');
  h.unmount();
  assert.equal(h.intervals.size,0);
  assert.equal(h.listeners.document.size,0);assert.equal(h.listeners.window.size,0,'cleanup removes recovery handlers');
  const disabled=harness({...props,enabled:false});await disabled.settle();disabled.value.refresh();disabled.emit('window','online');await disabled.settle();assert.equal(disabled.requests.length,0);disabled.unmount();
  console.log('delivery hook: manual/recovery refresh, bounded polling, abort/stale isolation, checked time and cleanup passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
