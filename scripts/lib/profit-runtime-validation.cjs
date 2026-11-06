function runtimeValidationMode(env){
 if(env.PROBE_RUNTIME_CANARY===undefined)return false;
 if(env.PROBE_RUNTIME_CANARY!=='main-output-only'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||!/^\d+-\d+$/.test(env.RUNTIME_CANARY_RUN_ID||'')||env.PROBE_YEAR!=='2026'||env.PROBE_WEEK!=='44')throw Object.assign(Error(),{code:'RUNTIME_VALIDATION_MODE_DENIED'});
 return true;
}
function assessRound(messages){
 const reads=messages.filter(x=>x.profitUiReadDiagnostic===true);
 if(messages.some(x=>x.runtimeHttpFailure===true)||reads.some(x=>x.event==='requestfailed'))throw Error('RUNTIME_HTTP_FAILURE');
 for(const kind of ['main','output']){
  const requests=reads.filter(x=>x.event==='request'&&x.kind===kind),headers=reads.filter(x=>x.event==='response_headers'&&x.kind===kind);
  if(requests.length!==1||requests[0].scopeMatches!==true||headers.length!==1||headers[0].httpStatus!==200||!Number.isFinite(headers[0].elapsedMs)||headers[0].elapsedMs<0||headers[0].elapsedMs>120000)throw Error('RUNTIME_READ_BUDGET_FAILED');
 }
 const result=messages.find(x=>x.status==='PASS'&&x.scope?.year==='2026'&&x.scope?.week==='44');
 // blockedWrites counts successfully intercepted non-GET attempts, not DB writes.
 if(!result||result.requests!==1||result.httpStatuses?.length!==1||result.httpStatuses[0]!==200||!Number.isInteger(result.blockedWrites)||result.blockedWrites<0||result.actualBusinessWrites!==0||!Array.isArray(result.initialScreenDifferences)||result.initialScreenDifferences.length||!/^[a-f0-9]{64}$/.test(result.financialDigest||'')||!messages.some(x=>x.runtimeAuditSkipped===true))throw Error('RUNTIME_FILE_MONEY_FAILED');
 return {financialDigest:result.financialDigest,mainOutputPass:true};
}
function assessRounds(hashes){if(hashes.length!==2||hashes.some(h=>!/^[a-f0-9]{64}$/.test(h||''))||hashes[0]!==hashes[1])throw Error('RUNTIME_ROUND_MONEY_CHANGED');return {rounds:2,moneyMatch:true,http5xx:0};}
module.exports={runtimeValidationMode,assessRound,assessRounds};
