const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chinaGuideStep: step, chinaGuideEnabled: enabled, CHINA_GUIDE_KEY } = require('../lib/chinaVolumeGuide.js');
for(const value of [null,undefined,'stale','true','0']) assert.equal(enabled(value),true);
assert.equal(enabled('false'),false);
assert.notEqual(CHINA_GUIDE_KEY,'nenova.dutch-volume-guide.v1');
const base={scopeCurrent:true,editReady:true,saved:true};
assert.equal(step({}).id,'scope');
assert.equal(step({scopeConfirmed:true}).id,'load');
assert.equal(step({scopeCurrent:true}).id,'edit');
assert.equal(step({...base,saved:false}).id,'save');
assert.equal(step(base).id,'review');
assert.equal(step({...base,preview:true}).id,'blocked');
assert.equal(step({...base,preview:true,canApply:true}).id,'apply');
assert.equal(step({...base,packingReview:true,unmatched:true}).id,'match');
assert.equal(step({...base,packingReview:true,unmatched:0,canMatch:false}).id,'split');
assert.equal(step({...base,packingReview:true,canMatch:true}).id,'packing');
assert.equal(step({...base,applied:true}).id,'done');
assert.equal(step({...base,applied:true,error:true}).id,'error');
assert.equal(step({...base,applied:true,busy:true}).id,'busy');
for(const year of [2025,2026]) assert.equal(step({...base,year,scopeCurrent:false,applied:true}).id,'scope');
const china=fs.readFileSync('pages/stats/china-volume-board.js','utf8');
const dutch=fs.readFileSync('pages/stats/dutch-volume-board.js','utf8');
for(const source of [china,dutch]) assert.match(source,/>작업 초기화<\/button>/);
assert.match(china,/result\.current \|\| result\.boards\?\.\[0\]/);
assert.match(china,/restored\.orderYear !== year \|\| restored\.orderWeek !== week/);
assert.match(china,/guideAppliedStamp === guideStamp && !dirty/);
assert.match(dutch,/lastSavedWork\.year !== year \|\| lastSavedWork\.week !== week/);
assert.match(dutch,/restoreWork\(lastSavedWork\.id, true\)/);
const component=fs.readFileSync('components/ChinaVolumeGuide.js','utf8');
assert.doesNotMatch(component,/fetch\(|apiPost\(|\.click\(/);
console.log('China guide states and scoped last-save reset contracts passed');

// Execute the page's real reset handler; every request is a read-only stub.
async function verifyReset() {
  const source = china.slice(china.indexOf('  const resetWork = async () => {'), china.indexOf('  const deleteBoard = async () => {'));
  const run = async (overrides = {}) => {
    const calls = [], errors = [], restored = [];
    const values = { scopeCurrent:true, saving:false, loading:false, busyRef:{current:false}, boardKey:'saved', year:2026, week:'43-02', window:{confirm:()=>true},
      apiGet:async (...args)=>{calls.push(args);return {current:{boardKey:'saved',orderYear:2026,orderWeek:'43-02',cells:{quantity:8}}};}, normalizeBoard:b=>b,
      applyBoard:b=>restored.push(b), setError:e=>errors.push(e), ...overrides };
    for(const setter of source.matchAll(/\b(set[A-Z]\w*)\(/g)) if(!values[setter[1]]) values[setter[1]]=()=>{};
    const names=Object.keys(values);
    await new Function(...names,`${source}; return resetWork();`)(...names.map(n=>values[n]));
    return {calls,errors,restored,values};
  };
  const ok=await run(); assert.equal(ok.restored[0].cells.quantity,8); assert.deepEqual(ok.calls,[['/api/stats/china-volume-board',{boardKey:'saved'}]]); assert.equal(ok.values.busyRef.current,false);
  for(const overrides of [{window:{confirm:()=>false}},{boardKey:''},{scopeCurrent:false},{saving:true}]) {const r=await run(overrides);assert.equal(r.calls.length,0);assert.equal(r.restored.length,0);}
  for(const bad of [{boardKey:'other',orderYear:2026,orderWeek:'43-02'},{boardKey:'saved',orderYear:2025,orderWeek:'43-02'},null]) {const r=await run({apiGet:async()=>({current:bad})});assert.equal(r.restored.length,0);assert(r.errors.some(e=>e.includes('실패')));}
  const failed=await run({apiGet:async()=>{throw new Error('network');}}); assert.equal(failed.restored.length,0);assert.equal(failed.values.busyRef.current,false);
  console.log('China reset real handler: saved quantity, cancel, missing, cross-year, wrong ID, network failure passed');
}
verifyReset().catch(error=>{console.error(error);process.exitCode=1;});
