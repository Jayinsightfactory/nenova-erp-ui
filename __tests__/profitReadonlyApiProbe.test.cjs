const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {runProfitReadProbe:run,scope}=require('../scripts/profit-readonly-api-probe.cjs');
test('context then captured main exactly once; output/audit/browser/mutation and redirect forbidden',async()=>{
 const calls=[],logs=[];
 const out=await run({year:'2026',week:'44',token:'PRIVATE_TOKEN',log:value=>logs.push(value),fetchFn:async(url,options)=>{calls.push({url,options});return {status:200,ok:true,json:async()=>({success:true,financialReadPolicy:{basis:'live'},note:'PRIVATE_NOTE',rows:[{name:'PRIVATE_PERSON'}]})};}});
 assert.equal(out.ok,true);assert.deepEqual(calls.map(call=>call.url),['https://nenovaweb.com/api/sales/profit-report?context=1','https://nenovaweb.com/api/sales/profit-report?year=2026&week=44']);
 for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.authorization,'Bearer PRIVATE_TOKEN');}
 assert(!logs.join('').includes('PRIVATE_'));assert.equal(JSON.parse(logs[1]).financialBasis,'live');
});
test('HTTP/code whitelist and failure stop; no expensive output or retry',async()=>{
 let calls=0;const logs=[];
 const out=await run({token:'secret',log:value=>logs.push(value),fetchFn:async()=>{calls++;return {status:503,ok:false,json:async()=>({success:false,code:'PROFIT_SOURCES_CHANGED',error:'PRIVATE_DETAIL'})};}});
 assert.equal(out.ok,false);assert.equal(calls,1);assert.equal(out.results[0].bodyCode,'PROFIT_SOURCES_CHANGED');assert(!logs.join('').includes('PRIVATE_DETAIL'));
 const hidden=await run({token:'secret',log:()=>{},fetchFn:async()=>({status:500,ok:false,json:async()=>({code:'token=PRIVATE',financialReadPolicy:{basis:'PRIVATE'}})})});
 assert.equal(hidden.results[0].bodyCode,null);assert.equal(hidden.results[0].financialBasis,null);
 assert.equal(hidden.results[0].codePresent,true);
});
test('output target reads context then exactly one fixed-scope eight-column output, never main or retry',async()=>{
 const calls=[],logs=[];
 const result=await run({year:'2026',week:'44',target:'output',token:'PRIVATE_TOKEN',log:value=>logs.push(value),fetchFn:async(url,options)=>{
  calls.push({url,options});const context=calls.length===1;
  return {status:context?200:500,ok:context,json:async()=>context?{success:true}:{success:false,code:'EREQUEST',error:'PRIVATE_ERROR',rows:['PRIVATE_ROWS']}};
 }});
 assert.equal(result.ok,false);assert.equal(calls.length,2);assert.equal(calls[0].url,'https://nenovaweb.com/api/sales/profit-report?context=1');
 assert.equal(calls[1].url,'https://nenovaweb.com/api/sales/profit-report-output?year=2026&week=44&cols=C,E,F,G,H,I,J,K&category=1');
 assert.equal(result.results[1].stage,'output');assert.equal(result.results[1].bodyCode,'EREQUEST');assert.equal(result.results[1].codePresent,true);
 assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.redirect,'error');assert.doesNotMatch(logs.join(''),/PRIVATE|workbook|rows|"error":/);
});
test('180-second global budget bounds even body wait; timeout stops without retry',async()=>{
 let calls=0;
 const result=await run({token:'secret',deadlineMs:10,log:()=>{},fetchFn:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('PRIVATE'),{name:'AbortError'})),{once:true}));}});
 assert.equal(calls,1);assert.equal(result.results[0].outcome,'deadline');assert.equal(result.ok,false);
 for(const deadlineMs of [0,false,180001])await assert.rejects(run({token:'secret',deadlineMs}),/PROBE_DEADLINE_INVALID/);
});
test('invalid scope or missing credential never contacts a service; prior-year same week stays distinct',async()=>{
 let calls=0;const fetchFn=async()=>{calls++;throw Error('Unexpected');};
 for(const [year,week]of [['2026','44,45'],['2026','0'],['2026','54'],['','44']])await assert.rejects(run({year,week,token:'secret',fetchFn}));
 await assert.rejects(run({year:'2026',week:'44',fetchFn}),/CREDENTIAL/);assert.equal(calls,0);
 for(const target of [null,0,false,'OUTPUT','output?year=2025','audit',''])await assert.rejects(run({target,token:'secret',fetchFn}),/PROBE_TARGET_INVALID/);
 assert.equal(calls,0);
 assert.deepEqual(scope('2025','44'),{year:'2025',week:'44'});assert.deepEqual(scope('2026','1'),{year:'2026',week:'01'});
});
test('workflow explicitly selects GET-only or original download branch; no deploy job',()=>{
 const text=fs.readFileSync('.github/workflows/profit-download-smoke.yml','utf8');
 assert.match(text,/readonly_api:/);assert.match(text,/inputs.readonly_api == true/);assert.match(text,/inputs.readonly_api != true/);assert.match(text,/node scripts\/profit-readonly-api-probe.cjs/);
 assert(!text.includes('pm2'));assert(!text.includes('ssh-action'));
 assert.match(text,/probe_target:[\s\S]*?type: choice[\s\S]*?- main[\s\S]*?- output[\s\S]*?default: main/);
 assert.match(text,/PROBE_TARGET: \$\{\{ inputs.probe_target \}\}/);
});
