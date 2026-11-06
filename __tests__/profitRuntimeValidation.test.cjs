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
