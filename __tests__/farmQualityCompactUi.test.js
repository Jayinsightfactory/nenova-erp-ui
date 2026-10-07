const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../pages/sales/farm-quality.js'), 'utf8');
assert.match(source, /\.quality\{color:#19304f/, 'original base layout is retained');
assert.equal((source.match(/<style jsx>/g)||[]).length, 1, 'one styled-jsx scope');
assert.match(source, /\.case-list,\.with-detail \.case-list\{grid-template-columns:1fr;gap:8px/, 'readable full-width rows');
assert.match(source, /\.workspace\.with-detail\{grid-template-columns:minmax\(0,1fr\)\}/, 'detail and list use full page width');
assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'three recent events share a row');
assert.match(source, /\.composer textarea\{height:90px/, 'readable editable composer');
assert.match(source, /@media\(max-width:900px\)/, 'narrow layout stacks');
assert.match(source, /latestEvents\(c.RecentEvents\)\.map/, 'sort only presentation');
assert.ok(source.includes('className="case-status">{labels[qualityStatus(c,today())]'), 'status is text, not color only');
assert.ok(source.includes("{c.CreatedByName}{' · '}"), 'metadata has a visible separator');
assert.match(source, /if\(id===sequence.current\)setData\(d\)/, 'load handler preserves original data');
for(const token of ['onClick={event=>open(c,event.currentTarget)}','onClick={removeCase}','onClick={save}','uploadEvidence','evidenceUrl','title={e.Body}']) assert.ok(source.includes(token), 'preserve '+token);
assert.doesNotMatch(source, /100vh|max-height\s*:|overflow\s*:\s*auto/, 'all list/history breakpoints use whole-page vertical flow');
assert(source.indexOf('<aside className="detail"')<source.indexOf('<div className="case-list">'), 'detail precedes potentially thousands of cases in DOM and keyboard order');
assert.match(source, /detailRef\.current\.focus\(\{preventScroll:true\}\)/);
assert.match(source, /detailRef\.current\.scrollIntoView\(\{block:'start'\}\)/);
assert.match(source, /selectionTrigger\.current\?\.focus\(\)/, 'closing restores originating card focus');
assert.match(source, /\.quality\{padding:12px;font-size:14px;line-height:1\.5\}/);
const expression=source.match(/const latestEvents=(.*);/)[1];
const latest=vm.runInNewContext('('+expression+')');
const fixture=[{EventNo:2},{EventNo:41},{EventNo:7},{EventNo:18}];
assert.equal(JSON.stringify(latest(fixture).map(e=>e.EventNo)), '[41,18,7]');
assert.equal(JSON.stringify(fixture.map(e=>e.EventNo)), '[2,41,7,18]', 'do not mutate source');
assert.equal(latest([]).length,0);
assert.equal(latest(undefined).length,0);
assert.ok(!source.includes('.case-events>small{display:none}'), 'older history count stays visible');
console.log('Farm quality compact UI tests passed: base styles, density, latest 3, immutable data, handlers, responsive layout');

async function deletionFocusRegression(){
 const body=source.match(/useEffect\(\(\)=>\{(\s*if\(!deleteFocusPending[\s\S]*?)\},\[saving,loading\]\)/)[1];
 const restore=new Function('deleteFocusPending','saving','loading','saveLock','selectionTrigger','deleteFocusFallback',body);
 assert(source.includes('<button ref={deleteFocusFallback} onClick={load} disabled={loading||saving}>'),'fallback is the scoped persistent refresh button');
 const handlerCode=source.slice(source.indexOf(' async function removeCase(){'),source.indexOf(' return <>'));
 for(const scenario of ['connected','detached','disabled','no-origin','refresh-failed','delete-failed']){
  const calls=[],pendingFocus={current:false},saveLock={current:false};
  const original=scenario==='no-origin'?null:{isConnected:scenario!=='detached'&&scenario!=='refresh-failed',disabled:scenario==='disabled',focus(){calls.push('original');}};
  const fallback={isConnected:true,disabled:false,focus(){calls.push('refresh');}};
  let saving=false,loading=false,selected='c1',finishRefresh;
  const invoke=()=>restore(pendingFocus,saving,loading,saveLock,{current:original},{current:fallback});
  const load=()=>{loading=true;return new Promise(resolve=>{finishRefresh=()=>{loading=false;resolve(scenario!=='refresh-failed');};});};
  const fetch=async()=>({ok:scenario!=='delete-failed'});
  const handler=new Function('current','data','saveLock','loading','window','setSaving','setError','setMessage','fetch','year','parseJsonResponse','deleteFocusPending','eventSequence','setSelected','setEvents','clearComposer','load','events',handlerCode+';return removeCase;')(
   {CaseKey:'c1',Version:3,Title:'선택 이력'},{canDelete:true},saveLock,false,{confirm:()=>true},value=>saving=value,()=>{},()=>{},fetch,2026,async()=>({eventCount:2,error:'삭제 실패'}),pendingFocus,{current:0},value=>selected=value,()=>{},()=>{},load,[]);
  const deletion=handler();await new Promise(resolve=>setImmediate(resolve));
  if(scenario==='delete-failed'){await deletion;invoke();assert.equal(selected,'c1');assert.deepEqual(calls,[]);continue;}
  assert.equal(selected,null);assert.equal(pendingFocus.current,true);
  invoke();assert.deepEqual(calls,[],'no focus during refresh/saving');
  finishRefresh();await deletion;
  assert.equal(saving,false);assert.equal(loading,false);assert.equal(saveLock.current,false);
  if(scenario!=='connected'){fallback.disabled=true;invoke();assert.deepEqual(calls,[],'wait for fallback to become enabled');fallback.disabled=false;}
  invoke();assert.deepEqual(calls,[scenario==='connected'?'original':'refresh'],scenario);
  invoke();assert.equal(calls.length,1,'focus restoration is consumed once');
 }
 console.log('Legacy deletion focus: post-refresh original/fallback, refresh failure and delete failure passed');
}
deletionFocusRegression().catch(error=>{console.error(error);process.exitCode=1;});
