const test=require('node:test'),assert=require('node:assert/strict');
const {runtimeValidationMode:mode,assessRound:assess,assessRounds}=require('../scripts/lib/profit-runtime-validation.cjs');
test('repeat audit skip is explicit CI-only exact44; default preserves independent audit',()=>{
 assert.equal(mode({}),false);const permitted={PROBE_RUNTIME_CANARY:'main-output-only',CI:'true',GITHUB_ACTIONS:'true',RUNTIME_CANARY_RUN_ID:'123-1',PROBE_YEAR:'2026',PROBE_WEEK:'44'};assert.equal(mode(permitted),true);
 for(const change of [{PROBE_RUNTIME_CANARY:false},{PROBE_RUNTIME_CANARY:'false'},{CI:'false'},{GITHUB_ACTIONS:'false'},{RUNTIME_CANARY_RUN_ID:''},{PROBE_YEAR:'2025'},{PROBE_WEEK:'43'}])assert.throws(()=>mode({...permitted,...change}));
 const reads=['main','output'].flatMap(kind=>[{profitUiReadDiagnostic:true,event:'request',kind,scopeMatches:true},{profitUiReadDiagnostic:true,event:'response_headers',kind,httpStatus:200,elapsedMs:90000}]);
 const result={status:'PASS',scope:{year:'2026',week:'44'},requests:1,httpStatuses:[200],blockedWrites:0,actualBusinessWrites:0,initialScreenDifferences:[],financialDigest:'a'.repeat(64)};
 const valid=[...reads,result,{runtimeAuditSkipped:true}];assert.equal(assess(valid).mainOutputPass,true);
 for(const bad of [[...valid,{runtimeHttpFailure:true}], [...valid,reads[0]],valid.map(x=>x.event==='response_headers'?{...x,elapsedMs:120001}:x),valid.map(x=>x===result?{...x,initialScreenDifferences:[{}]}:x),valid.filter(x=>!x.runtimeAuditSkipped)])assert.throws(()=>assess(bad));
});
test('two actual rounds must both finish with identical valid monetary digest',()=>{
 const a='a'.repeat(64),b='b'.repeat(64);assert.deepEqual(assessRounds([a,a]),{rounds:2,moneyMatch:true,http5xx:0});
 for(const hashes of [[],[a],[a,a,a],[a,b],[a,null],['','']])assert.throws(()=>assessRounds(hashes));
});
test('readonly repeat workflow is exclusive, defaults keep audit, no runtime apply',()=>{
 const text=require('node:fs').readFileSync(require('node:path').join(__dirname,'../.github/workflows/profit-download-smoke.yml'),'utf8');
 assert.match(text,/repeat_recent_download:[\s\S]*?default: false/);
 assert.match(text,/if: inputs.readonly_api != true && inputs.repeat_recent_download != true/);
 assert.match(text,/if: inputs.repeat_recent_download == true && inputs.readonly_api != true/);
 assert.match(text,/node-version: 20/);assert.doesNotMatch(text,/runtime-memory-canary\.cjs|pm2 restart|pm2 save/);
});
test('repeat runner forwards strictly allowlisted observer fields, never arbitrary nested values or errors',()=>{
 const {safeObserver:safe,safeFailure}=require('../scripts/profit-runtime-two-rounds.cjs');
 const privateValue='PRIVATE_TOKEN_BODY_SQL_USER_ERROR',extra={message:privateValue,token:privateValue,url:privateValue,raw:privateValue};
 for(const event of ['request','requestfailed','response_headers','response_body','summary','explicit_query']){
  const result=safe({profitUiReadDiagnostic:true,event,id:1,kind:'main',elapsedMs:123,scope:{year:'2026',week:'44',...extra},scopeMatches:true,httpStatus:502,bodyCode:'EREQUEST',bodyState:'api_error',codePresent:true,basis:'live',payloadScopeMatches:false,aborted:true,stage:'ui_ready_timeout',selected:{year:'2026',week:'44',...extra},counts:{main:1,output:0,...extra},failed:1,pending:0,ui:{scope:{year:'2026',week:'44',...extra},alerts:1,exportEnabled:false,...extra},...extra});
  assert.equal(result.event,event);assert.equal(result.profitUiReadDiagnostic,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|message|token|url|raw/);
 }
 const invalid=safe({profitUiReadDiagnostic:true,event:'response_body',kind:privateValue,id:privateValue,elapsedMs:-1,httpStatus:privateValue,bodyCode:privateValue,bodyState:privateValue,basis:privateValue,codePresent:privateValue});assert.equal(invalid.bodyCode,null);assert.equal(invalid.codePresent,null);assert.doesNotMatch(JSON.stringify(invalid),/PRIVATE/);
 assert.equal(safe({profitUiReadDiagnostic:true,event:privateValue}),null);assert.equal(safe({status:'PASS',...extra}),null);
 const summary=safe({profitUiReadDiagnostic:true,event:'summary',stage:privateValue,selected:{year:privateValue,week:['44']},counts:{main:privateValue},ui:{scope:privateValue,alerts:privateValue,exportEnabled:privateValue}});assert.equal(summary.selected.week,null);assert.doesNotMatch(JSON.stringify(summary),/PRIVATE/);
 for(const error of [Error(privateValue),{code:privateValue,message:privateValue},{code:'RUNTIME_CHILD_EXIT',message:privateValue}])assert.doesNotMatch(JSON.stringify(safeFailure(error)),/PRIVATE/);
});
test('repeat child exit, deadline, spawn and assessment failures expose only fixed reason/code',async()=>{
 const {EventEmitter}=require('node:events'),{round,safeFailure}=require('../scripts/profit-runtime-two-rounds.cjs');
 for(const mode of ['exit','deadline','spawn','assess']){
  const lines=[],spawnChild=()=>{
   if(mode==='spawn')throw Error('PRIVATE_SPAWN');const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('exit',null);
   queueMicrotask(()=>{child.stderr.emit('data','PRIVATE_STDERR');child.stdout.emit('data','PRIVATE_STDOUT\n'+JSON.stringify({profitUiReadDiagnostic:true,event:'response_headers',id:1,kind:'main',httpStatus:502,elapsedMs:120000,token:'PRIVATE_TOKEN'})+'\n');if(mode!=='deadline')child.emit('exit',mode==='exit'?1:0);});return child;
  };
  let caught;try{await round({spawnChild,log:line=>lines.push(line),deadlineMs:5});assert.fail('must fail');}catch(error){caught=error;}
  const result=safeFailure(caught);assert.equal(result.reason,{exit:'child_exit',deadline:'deadline',spawn:'child_spawn',assess:'assess'}[mode]);assert.doesNotMatch(JSON.stringify({lines,result}),/PRIVATE/);
  if(mode!=='spawn'){assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]).httpStatus,502);}
 }
});
test('file summary and HTTP failure are allowlisted, actual diff contents remain private',()=>{
 const {safeResult}=require('../scripts/profit-runtime-two-rounds.cjs'),privateValue='PRIVATE_TOKEN_SQL_BODY';
 const result=safeResult({status:'PASS',scope:{year:'2026',week:'44',token:privateValue},requests:1,httpStatuses:[200],blockedWrites:2,actualBusinessWrites:0,initialScreenDifferences:[{row:privateValue}],financialDigest:'a'.repeat(64),bytes:50000,sheets:1,token:privateValue,error:privateValue,rows:[privateValue]});
 assert.deepEqual(result,{runtimeFileResult:true,status:'PASS',scope:{year:'2026',week:'44'},requests:1,httpStatuses:[200],blockedWrites:2,actualBusinessWrites:0,initialDifferenceCount:1,financialDigest:'a'.repeat(64),bytes:50000,sheets:1});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|token|error|rows/);
 assert.deepEqual(safeResult({runtimeHttpFailure:true,status:502,kind:'output',body:privateValue}),{runtimeHttpFailure:true,status:502,kind:'output'});
 for(const kind of ['main','output','week-check','stock-notes','other-api'])assert.equal(safeResult({runtimeHttpFailure:true,status:500,kind}).kind,kind);
 assert.equal(safeResult({runtimeHttpFailure:true,status:500,kind:privateValue}).kind,null);
 assert.equal(safeResult({runtimeHttpFailure:false}),null);assert.equal(safeResult({runtimeHttpFailure:true,status:privateValue}).status,null);
});
test('blocked nonGET attempts are preserved as successful interception, not business writes',()=>{
 const fs=require('node:fs'),path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'../scripts/profit-production-download-smoke.cjs'),'utf8');
 assert.match(source,/await page\.setRequestInterception\(true\)/);
 const marker="page.on('request',",start=source.indexOf(marker),end=source.indexOf('\n  });',start);assert.ok(start>=0&&end>start);
 const callback=source.slice(start+marker.length,end)+'\n  }';
 const requests=[],h=new Function('origin','year','week','requests','token','assert','let blockedWrites=0;const handler='+callback+';return {handler,count:()=>blockedWrites};')('https://nenovaweb.com','2026','44',requests,'PRIVATE_TOKEN',assert);
 let aborted=0,continued=0;for(const method of ['POST','PATCH','DELETE'])h.handler({url:()=> 'https://nenovaweb.com/api/sales/profit-report',method:()=>method,abort:reason=>{assert.equal(reason,'blockedbyclient');aborted++;},continue:()=>{continued++;}});
 assert.equal(aborted,3);assert.equal(continued,0);assert.equal(h.count(),3);assert.equal(requests.length,0);
});
test('round assessment fixed codes separate HTTP, read budget and real file/money failure',async()=>{
 const {round}=require('../scripts/profit-runtime-two-rounds.cjs'),{EventEmitter}=require('node:events');
 const reads=['main','output'].flatMap(kind=>[{profitUiReadDiagnostic:true,event:'request',kind,scopeMatches:true},{profitUiReadDiagnostic:true,event:'response_headers',kind,httpStatus:200,elapsedMs:80000}]);
 const result={status:'PASS',scope:{year:'2026',week:'44'},requests:1,httpStatuses:[200],blockedWrites:3,actualBusinessWrites:0,initialScreenDifferences:[],financialDigest:'a'.repeat(64)};
 const valid=[...reads,result,{runtimeAuditSkipped:true}];assert.equal(assess(valid).mainOutputPass,true);
 for(const blockedWrites of [-1,false,undefined,1.5])assert.throws(()=>assess(valid.map(x=>x===result?{...x,blockedWrites}:x)));
 const cases=[['RUNTIME_HTTP_FAILURE',[...valid,{runtimeHttpFailure:true,status:500}]],['RUNTIME_READ_BUDGET_FAILED',valid.map(x=>x.event==='response_headers'?{...x,elapsedMs:120001}:x)],['RUNTIME_FILE_MONEY_FAILED',valid.map(x=>x===result?{...x,actualBusinessWrites:1}:x)]];
 for(const [code,messages]of cases){const spawnChild=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};queueMicrotask(()=>{c.stdout.emit('data',messages.map(x=>JSON.stringify(x)).join('\n')+'\n');c.emit('exit',0);});return c;};await assert.rejects(round({spawnChild,log:()=>{}}),{code});}
});
