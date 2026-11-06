// Runner only. Child stdout/stderr are private; emit fixed validation fields/digests only.
const {spawn}=require('node:child_process');
const {runtimeValidationMode,assessRound,assessRounds}=require('./lib/profit-runtime-validation.cjs');
async function round(){
 const messages=[];
 const child=spawn(process.execPath,['scripts/profit-production-download-smoke.cjs'],{env:process.env,stdio:['ignore','pipe','pipe']});
 let pending='';child.stdout.on('data',chunk=>{pending+=chunk;for(;;){const end=pending.indexOf('\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+1);try{messages.push(JSON.parse(line));}catch{}}});child.stderr.on('data',()=>{});
 let deadline=false;const timer=setTimeout(()=>{deadline=true;child.kill();},270000);
 try{const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});if(deadline||code!==0)throw Error('RUNTIME_CHILD_FAILED');return assessRound(messages);}finally{clearTimeout(timer);}
}
async function main(){
 if(runtimeValidationMode(process.env)!==true)throw Error('RUNTIME_VALIDATION_MODE_DENIED');const hashes=[];
 for(let i=0;i<2;i++){const result=await round();hashes.push(result.financialDigest);console.log(JSON.stringify({runtimeRound:i+1,result:'PASS',mainOutputPass:true,financialDigest:result.financialDigest}));}
 console.log(JSON.stringify({runtimeValidation:'PASS',...assessRounds(hashes)}));
}
if(require.main===module)main().catch(()=>{console.log(JSON.stringify({runtimeValidation:'FAIL'}));process.exitCode=1;});
module.exports={main};
