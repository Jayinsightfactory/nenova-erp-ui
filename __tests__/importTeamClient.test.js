import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const babel=require('next/dist/compiled/babel/core');
const source=readFileSync(new URL('../lib/importTeamClient.js',import.meta.url),'utf8');
const compiled=babel.transformSync(source,{
  filename:'importTeamClient.js',babelrc:false,configFile:false,
  plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code;
const sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((item,index)=>Object.is(item,b[index]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the actual hook with controlled effects and deferred fetch responses.
// No requests leave this process and no runtime/DB data is written.
function harness(initialKey='checklist.pending',initialValue=[]) {
  const slots=[],effects=[],requests=[];
  let cursor=0,key=initialKey,initial=initialValue,writes=0;
  const hooks={
    useRef(value){const index=cursor++;if(!(index in slots))slots[index]={current:value};return slots[index];},
    useState(value){const index=cursor++;if(!(index in slots))slots[index]=typeof value==='function'?value():value;return [slots[index],next=>{writes++;slots[index]=typeof next==='function'?next(slots[index]):next;}];},
    useCallback(callback,deps){const index=cursor++;if(!sameDeps(slots[index]?.deps,deps))slots[index]={deps,value:callback};return slots[index].value;},
    useEffect(callback,deps){const index=cursor++;if(!sameDeps(slots[index]?.deps,deps)){const old=slots[index];slots[index]={deps,callback,cleanup:old?.cleanup};effects.push(index);}},
  };
  const module={exports:{}};
  vm.runInNewContext(compiled,{
    module,exports:module.exports,
    require(name){assert.equal(name,'react');return hooks;},
    fetch(url,options){
      let resolve,reject;
      const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      requests.push({url,options,body:options?.body?JSON.parse(options.body):undefined,resolve(value,revision=0,status=200,error=''){
        resolve({ok:status>=200&&status<300,status,json:async()=>({success:status>=200&&status<300,key:new URL(url,'http://local.test').searchParams.get('key'),value,revision,history:[{revision}],error})});
      },reject});
      return promise;
    },
  });
  const h={
    requests,result:null,
    get writes(){return writes;},
    render(nextKey=key,nextInitial=initial){key=nextKey;initial=nextInitial;cursor=0;this.result=module.exports.useImportTeamRecord(key,initial);return this.result;},
    effects(){for(const index of effects.splice(0)){slots[index].cleanup?.();slots[index].cleanup=slots[index].callback();}},
    async refresh(){await tick();return this.render();},
    unmount(){for(const slot of slots)slot?.cleanup?.();},
    strictReplay(){for(const slot of slots){if(slot?.callback){slot.cleanup?.();slot.cleanup=slot.callback();}}},
  };
  h.render();h.effects();h.render();
  return h;
}
async function loaded(key='checklist.pending',value=[],revision=1){const h=harness(key);h.requests[0].resolve(value,revision);await h.refresh();return h;}

test('A save -> B key resets saving/loading/version immediately; A completion cannot overwrite B',async()=>{
  const h=await loaded('checklist.pending',[{id:'a'}],5);
  const savedA=h.result.save([{id:'a-new'}]);
  h.render();assert.equal(h.result.saving,true);
  h.render('checklist.flights');
  assert.equal(h.result.saving,false);
  assert.equal(h.result.loading,true);
  assert.deepEqual(h.result.value,[]);
  assert.equal(h.result.revision,0);
  h.effects();h.render();
  assert.deepEqual(h.result.value,[],'loading B must not reuse A payload');
  h.requests[2].resolve([{id:'b'}],8);
  await h.refresh();
  assert.equal(h.result.saving,false);
  h.requests[1].resolve([{id:'a-new'}],6);
  await savedA;await h.refresh();
  assert.deepEqual(h.result.value,[{id:'b'}]);
  assert.equal(h.result.revision,8);
  assert.equal(h.result.saving,false);
});

test('old A finally cannot release B save lock or clear B saving',async()=>{
  const h=await loaded('checklist.pending',[],2);
  const savedA=h.result.save([{id:'a'}]);
  h.render('checklist.flights');h.effects();
  h.requests[2].resolve([],7);await h.refresh();
  const savedB=h.result.save([{id:'b'}]);
  h.render();assert.equal(h.result.saving,true);
  assert.equal(h.requests[3].body.expectedRevision,7);
  h.requests[1].resolve([{id:'a'}],3);await savedA;await h.refresh();
  assert.equal(h.result.saving,true);
  await assert.rejects(h.result.save([{id:'duplicate'}]),/진행 중/);
  assert.equal(h.requests.length,4);
  h.requests[3].resolve([{id:'b'}],8);await savedB;await h.refresh();
  assert.equal(h.result.saving,false);
  assert.deepEqual(h.result.value,[{id:'b'}]);
});

test('A -> B -> A uses new scope: old A response cannot update new A visit',async()=>{
  const h=await loaded('checklist.pending',[],1);
  const staleSave=h.result.save([{id:'stale'}]);
  h.render('checklist.flights');h.effects();
  h.render('checklist.pending');h.effects();
  h.requests[3].resolve([{id:'fresh-a'}],4);await h.refresh();
  h.requests[1].resolve([{id:'stale'}],2);await staleSave;
  h.requests[2].resolve([{id:'b'}],10);await h.refresh();
  assert.deepEqual(h.result.value,[{id:'fresh-a'}]);
  assert.equal(h.result.revision,4);
  assert.equal(h.result.saving,false);
});

test('latest reload wins; older same-key read cannot overwrite successful save or revision',async()=>{
  const h=await loaded('checklist.pending',[{id:'initial'}],1);
  const olderRead=h.result.reload();
  const latestRead=h.result.reload();
  h.requests[2].resolve([{id:'latest'}],3);await latestRead;await h.refresh();
  const saved=h.result.save([{id:'saved'}]);
  assert.equal(h.requests[3].body.expectedRevision,3);
  h.requests[3].resolve([{id:'saved'}],4);await saved;await h.refresh();
  h.requests[1].resolve([{id:'old-snapshot'}],2);await olderRead;await h.refresh();
  assert.deepEqual(h.result.value,[{id:'saved'}]);
  assert.equal(h.result.revision,4);
  assert.equal(h.result.history[0].revision,4);
  assert.equal(h.result.loading,false);
  const nextSave=h.result.save([{id:'next'}]);
  assert.equal(h.requests[4].body.expectedRevision,4,'stale GET must not regress the save version');
  h.requests[4].resolve([{id:'next'}],5);await nextSave;
});

test('stale reload failure/finally cannot publish error or end latest loading',async()=>{
  const h=await loaded();
  const older=h.result.reload(),latest=h.result.reload();
  h.requests[1].reject(new Error('old network error'));
  await older;await h.refresh();
  assert.equal(h.result.error,'');
  assert.equal(h.result.loading,true);
  await assert.rejects(h.result.save([]),/진행 중/);
  h.requests[2].resolve([{id:'latest'}],2);await latest;await h.refresh();
  assert.equal(h.result.loading,false);
  assert.deepEqual(h.result.value,[{id:'latest'}]);
});

test('reload while PUT is in flight is ignored; save remains authoritative and single-flight',async()=>{
  const h=await loaded('checklist.pending',[{id:'old'}],2);
  const saved=h.result.save([{id:'new'}]);
  await h.result.reload();
  assert.equal(h.requests.length,2);
  h.render();assert.equal(h.result.saving,true);
  assert.deepEqual(h.result.value,[{id:'old'}],'no optimistic update');
  await assert.rejects(h.result.save([]),/진행 중/);
  h.requests[1].resolve([{id:'new'}],3);await saved;await h.refresh();
  const reloaded=h.result.reload();
  assert.equal(h.requests.length,3);
  h.requests[2].resolve([{id:'new'}],3);await reloaded;await h.refresh();
  assert.equal(h.result.saving,false);
  assert.equal(h.result.loading,false);
});

test('409 save rejects, keeps server value/revision, exposes error and releases lock for retry',async()=>{
  const h=await loaded('checklist.pending',[{id:'old'}],2);
  const saved=h.result.save([{id:'draft'}]);
  const rejected=assert.rejects(saved,error=>error.status===409&&/다른 직원/.test(error.message));
  h.requests[1].resolve(null,0,409,'다른 직원이 먼저 수정했습니다.');
  await rejected;await h.refresh();
  assert.equal(h.result.saving,false);
  assert.equal(h.result.revision,2);
  assert.deepEqual(h.result.value,[{id:'old'}]);
  assert.match(h.result.error,/다른 직원/);
  const reload=h.result.reload();h.requests[2].resolve([{id:'team-edit'}],3);await reload;await h.refresh();
  assert.equal(h.result.error,'');
  const retry=h.result.save([{id:'reviewed-draft'}]);
  assert.equal(h.requests[3].body.expectedRevision,3);
  h.requests[3].resolve([{id:'reviewed-draft'}],4);await retry;await h.refresh();
  assert.equal(h.result.saving,false);
});

test('old save rejection cannot leak A error into B or clear B saving',async()=>{
  const h=await loaded();
  const failedA=h.result.save([{id:'a'}]);
  const rejection=assert.rejects(failedA,/old A failure/);
  h.render('checklist.flights');h.effects();
  h.requests[2].resolve([],10);await h.refresh();
  const savedB=h.result.save([{id:'b'}]);
  h.requests[1].reject(new Error('old A failure'));await rejection;await h.refresh();
  assert.equal(h.result.error,'');
  assert.equal(h.result.saving,true);
  h.requests[3].resolve([{id:'b'}],11);await savedB;await h.refresh();
  assert.equal(h.result.saving,false);
});

test('old-key callbacks cannot request/reload after key changes',async()=>{
  const h=await loaded();
  const oldSave=h.result.save,oldReload=h.result.reload;
  h.render('checklist.flights');h.effects();
  await oldReload();await assert.rejects(oldSave([]),/진행 중/);
  assert.equal(h.requests.length,2);
  h.requests[1].resolve([],2);await h.refresh();
});

test('unmount invalidates pending requests and prevents post-unmount state writes',async()=>{
  const h=await loaded();
  const pending=h.result.save([{id:'late'}]);
  h.unmount();const writes=h.writes;
  h.requests[1].resolve([{id:'late'}],2);await pending;
  assert.equal(h.writes,writes);
  await assert.rejects(h.result.save([]),/진행 중/);
  await h.result.reload();assert.equal(h.requests.length,2);
});

test('effect replay (StrictMode) invalidates first GET, keeps new request and saves usable',async()=>{
  const h=harness();
  h.strictReplay();
  assert.equal(h.requests.length,2);
  h.requests[0].resolve([{id:'strict-stale'}],1);await h.refresh();
  assert.equal(h.result.loading,true);
  assert.deepEqual(h.result.value,[]);
  h.requests[1].resolve([{id:'strict-current'}],3);await h.refresh();
  assert.equal(h.result.loading,false);
  const saved=h.result.save([{id:'updated'}]);
  h.requests[2].resolve([{id:'updated'}],4);await saved;await h.refresh();
  assert.equal(h.result.saving,false);
  assert.equal(h.result.revision,4);
});

test('latest GET failure exposes error, blocks writes until successful reload, null uses initialValue',async()=>{
  const h=harness('checklist.day.2026-10-06',{});
  h.requests[0].reject(new Error('offline'));await h.refresh();
  assert.equal(h.result.loading,false);
  assert.equal(h.result.error,'offline');
  assert.deepEqual(h.result.value,{});
  await assert.rejects(h.result.save({a:true}),/진행 중/);
  const reload=h.result.reload();h.requests[1].resolve(null,0);await reload;await h.refresh();
  assert.equal(h.result.revision,0);
  assert.deepEqual(h.result.value,{});
  assert.equal(h.result.error,'');
  const saved=h.result.save({a:false});assert.deepEqual(h.requests[2].body,{expectedRevision:0,value:{a:false}});
  h.requests[2].resolve({a:false},1);await saved;await h.refresh();
  assert.deepEqual(h.result.value,{a:false});
});
