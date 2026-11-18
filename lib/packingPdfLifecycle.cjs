// Shared by Next admission and the deploy CLI. No ERP or provider access.
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {createHash}=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withLifecycleLock(root,fn,{timeoutMs=1500}={}){
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const physical=path.normalize(await fs.realpath(root));
  const canonical=process.platform==='win32'?physical.toLowerCase():physical;
  const name='nenova-pdf-lifecycle-'+createHash('sha256').update(canonical).digest('hex');
  const address=process.platform==='win32'?`\\\\.\\pipe\\${name}`:process.platform==='linux'?`\0${name}`:null;
  if(!address)throw Error('Unsupported PDF lifecycle platform');
  const deadline=Date.now()+timeoutMs;
  do{
    const server=net.createServer(socket=>socket.destroy());
    const error=await new Promise(resolve=>{server.once('error',resolve);server.listen({path:address,exclusive:true},()=>resolve(null));});
    if(!error){try{return await fn();}finally{await new Promise(resolve=>server.close(resolve));}}
    if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;
    await sleep(25);
  }while(Date.now()<deadline);
  throw Object.assign(Error('서버 업데이트 확인 중입니다. 파일을 유지하고 잠시 후 다시 진행하세요. 분석은 시작하지 않았습니다.'),{code:'JOB_STORAGE_BUSY'});
}
const validJob=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
function alive(pid){
  if(!Number.isSafeInteger(pid)||pid<=0)return true;
  try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}
async function activePdfJobs(root,{now=Date.now(),isAlive=alive}={}){
  let users;try{users=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const rows=[];
  for(const user of users){
    if(!user.isDirectory()||! /^[a-f0-9]{64}$/.test(user.name))continue;
    const dir=path.join(root,user.name);
    for(const name of await fs.readdir(dir)){
      if(!validJob.test(name))continue;
      const file=path.join(dir,name),stat=await fs.stat(file);
      if(stat.size>5*1024*1024)throw Error('Oversized PDF job record');
      const row=JSON.parse(await fs.readFile(file,'utf8'));
      if(row.status!=='RUNNING'||!isAlive(row.owner?.pid))continue;
      rows.push({ageSeconds:Number.isFinite(row.createdAt)?Math.max(0,Math.round((now-row.createdAt)/1000)):null,
        completed:(row.chunks||[]).filter(c=>c?.status==='SUCCEEDED').length,
        total:row.chunkProgress?.total??null});
    }
  }
  return rows;
}
module.exports={withLifecycleLock,activePdfJobs};
