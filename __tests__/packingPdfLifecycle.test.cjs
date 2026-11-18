const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {withLifecycleLock,activePdfJobs}=require('../lib/packingPdfLifecycle.cjs');
const {guardedDeploy}=require('../scripts/guard-pdf-deploy.cjs');
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-lifecycle-'));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function job(root,value){const dir=path.join(root,'a'.repeat(64));await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'12345678-1234-1234-1234-123456789abc.json');await fs.writeFile(file,JSON.stringify(value));return file;}
test('active current job blocks swap, including overdue jobs, without changing bytes',()=>fixture(async root=>{
 const file=await job(root,{status:'RUNNING',createdAt:1,deadline:2,owner:{pid:process.pid},chunks:[{status:'SUCCEEDED'}],chunkProgress:{total:6}});
 const before=await fs.readFile(file);let swaps=0;
 await assert.rejects(guardedDeploy(root,async()=>swaps++),{code:'PDF_ANALYSIS_ACTIVE'});
 assert.equal(swaps,0);assert.deepEqual(await fs.readFile(file),before);
}));
test('finished job permits one deployment and keeps completed chunks',()=>fixture(async root=>{
 const file=await job(root,{status:'SUCCEEDED',owner:{pid:process.pid},chunks:[{status:'SUCCEEDED'}]});const before=await fs.readFile(file);
 assert.equal(await guardedDeploy(root,async()=>42),42);assert.deepEqual(await fs.readFile(file),before);
}));
test('dead owner is reported as inactive, malformed records fail closed',()=>fixture(async root=>{
 const file=await job(root,{status:'RUNNING',owner:{pid:123}});
 assert.deepEqual(await activePdfJobs(root,{isAlive:()=>false}),[]);
 await fs.writeFile(file,'{');await assert.rejects(guardedDeploy(root,()=>assert.fail('must not swap')));
}));
test('same root mutex excludes admission during deployment and releases after failure',()=>fixture(async root=>{
 let release,entered;const ready=new Promise(r=>entered=r);
 const run=guardedDeploy(root,()=>new Promise(resolve=>{release=resolve;entered();}));await ready;
 await assert.rejects(withLifecycleLock(root,()=>assert.fail('must not admit'),{timeoutMs:50}),{code:'JOB_STORAGE_BUSY'});
 release(0);await run;
 await assert.rejects(withLifecycleLock(root,()=>{throw Error('fixture');}),/fixture/);
 assert.equal(await withLifecycleLock(root,()=>7),7);
}));
test('admitted running job is visible before a competing deployment can swap',()=>fixture(async root=>{
 await withLifecycleLock(root,()=>job(root,{status:'RUNNING',owner:{pid:process.pid}}));
 await assert.rejects(guardedDeploy(root,()=>assert.fail('must not swap')),{code:'PDF_ANALYSIS_ACTIVE'});
}));
test('unknown owner cannot allow reload and diagnostic output has no raw data',()=>fixture(async root=>{
 await job(root,{status:'RUNNING',source:'PRIVATE-PDF',owner:{},result:{content:'PRIVATE-RESPONSE'}});
 const rows=await activePdfJobs(root);assert.equal(rows.length,1);
 assert(!JSON.stringify(rows).includes('PRIVATE'));
 await assert.rejects(guardedDeploy(root,()=>assert.fail('must not swap')),{code:'PDF_ANALYSIS_ACTIVE'});
}));
test('workflow aborts on guard failure and swap/reload stay inside the guarded child',async()=>{
 const text=await fs.readFile(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
 const start=text.indexOf("node scripts/guard-pdf-deploy.cjs -- bash -e <<'PDF_SAFE_RELOAD' || exit 1");
 const end=text.indexOf('\n            PDF_SAFE_RELOAD',start);
 assert(start>0&&end>start);
 for(const command of ['rm -rf .next-previous','mv .next-build .next','pm2 reload nenova-erp','pm2 restart nenova-erp'])assert(text.slice(start,end).includes(command));
 assert(text.includes('cat scripts/diagnose-pdf-jobs-readonly.cjs'));
 const {spawnSync}=require('node:child_process');
 const script=text.slice(start,end+'\n            PDF_SAFE_RELOAD'.length).replace(/^            /gm,'');
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
 const syntax=spawnSync(bash,['-n'],{input:script,encoding:'utf8'});
 assert.equal(syntax.status,0,syntax.stderr);
});
