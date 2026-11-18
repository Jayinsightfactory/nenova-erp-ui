// Run the build swap + PM2 reload under the same mutex as PDF job admission.
// Refuse deployment, not analysis: never kill jobs, retry providers or edit jobs.
const path=require('node:path'),{spawn}=require('node:child_process');
const {withLifecycleLock,activePdfJobs}=require('../lib/packingPdfLifecycle.cjs');
async function guardedDeploy(root,run){
  return withLifecycleLock(root,async()=>{
    const active=await activePdfJobs(root);
    if(active.length){
      console.log('PDF_DEPLOY_BLOCKED '+JSON.stringify({activeCount:active.length,jobs:active.slice(0,24)}));
      throw Object.assign(Error('PDF analysis is active; keep the old build and retry deployment after completion.'),{code:'PDF_ANALYSIS_ACTIVE'});
    }
    return run();
  },{timeoutMs:10000});
}
module.exports={guardedDeploy};
if(require.main===module){
  const args=process.argv.slice(2);
  if(args[0]!=='--'||!args[1]){console.error('Usage: node scripts/guard-pdf-deploy.cjs -- command args...');process.exitCode=2;}
  else guardedDeploy(path.join(process.cwd(),'data/runtime/import-team/pdf-jobs'),()=>new Promise((resolve,reject)=>{
    const child=spawn(args[1],args.slice(2),{stdio:'inherit',shell:false});
    child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(Error('Deploy child terminated')):resolve(code??1));
  })).then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.code||'PDF_DEPLOY_GUARD_FAILED');process.exitCode=1;});
}
