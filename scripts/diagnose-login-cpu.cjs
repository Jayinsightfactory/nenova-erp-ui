// Bounded CPU sampling only: no heap, request data, environments or business mutations.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
async function captureLoginCpu(pid,dir,WebSocket,{enableNativeZlib=false,xlsxModule=path.join(dir,'node_modules/xlsx')}={}){
 const list=async()=>{try{return await(await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1500)})).json();}catch{return null;}};
 let targets=await list(),opened=false,ws,seq=0;const pending=new Map();
 const post=(method,params={},timeout=15000)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('PROTOCOL_TIMEOUT'));},timeout);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
 try{
  if(!targets){if(!/\/node(?:js)?$/.test(fs.realpathSync('/proc/'+pid+'/exe')))throw Error('NOT_NODE');process.kill(pid,'SIGUSR1');opened=true;for(let n=0;n<20&&!targets;n++){await new Promise(r=>setTimeout(r,250));targets=await list();}}
  if(!targets?.[0]?.webSocketDebuggerUrl)throw Error('INSPECTOR_UNAVAILABLE');const u=new URL(targets[0].webSocketDebuggerUrl);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='9229')throw Error('NONLOCAL_INSPECTOR');
  ws=new WebSocket(u.href);await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('SOCKET_TIMEOUT')),5000);ws.once('open',()=>{clearTimeout(t);r();});ws.once('error',j);});ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw));}catch{return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error('PROTOCOL_ERROR')):p.resolve(m.result);}});
  const identity=await post('Runtime.evaluate',{expression:"({pid:process.pid,canClose:typeof require==='function'||!!process.mainModule?.require})",returnByValue:true});if(identity.result?.value?.pid!==pid)throw Error('PID_MISMATCH');if(opened&&!identity.result.value.canClose)throw Error('CLOSE_UNAVAILABLE');
  if(enableNativeZlib){
   const expression=`(()=>{const req=typeof require==='function'?require:process.mainModule.require.bind(process.mainModule),x=req(${JSON.stringify(xlsxModule)}),book=x.utils.book_new();x.utils.book_append_sheet(book,x.utils.aoa_to_sheet([['fixture',1],['same',2]]),'7-1');const bytes=x.write(book,{type:'buffer',bookType:'xlsx',compression:true}),read=()=>{const b=x.read(bytes,{type:'buffer'});return JSON.stringify({names:b.SheetNames,rows:x.utils.sheet_to_json(b.Sheets['7-1'],{header:1})})},before=read();x.CFB.utils.use_zlib(req('node:zlib'));return before===read()})()`;
   const tuned=await post('Runtime.evaluate',{expression,returnByValue:true});if(tuned.exceptionDetails||tuned.result?.value!==true)throw Error('NATIVE_ZIP_FIXTURE_FAILED');
  }
  const stateExpression=`(()=>{const req=typeof require==='function'?require:process.mainModule.require.bind(process.mainModule),p=req(${JSON.stringify(path.join(dir,'node_modules/mssql'))}).pool,fs=req('node:fs'),size=n=>{try{return fs.statSync(${JSON.stringify(dir)}+'/'+n).size}catch{return null}},num=x=>Number.isFinite(x)?x:null;return {pool:p?{connected:!!p.connected,connecting:!!p.connecting,size:num(p.size),available:num(p.available),borrowed:num(p.borrowed),pending:num(p.pending)}:null,pmOfficeBytes:size('data/runtime/work-feature-pm-office.json'),driveIndexBytes:size('data/drive/index.jsonl')}})()`;
  let appState=null;try{const r=await post('Runtime.evaluate',{expression:stateExpression,returnByValue:true});appState=r.result?.value||null;}catch{}
  await post('Profiler.enable');await post('Profiler.start');await new Promise(r=>setTimeout(r,4000));const {profile}=await post('Profiler.stop');
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
  const safeName=n=>/^[\w$ .<>:[\]()-]{0,100}$/.test(n||'')?(n||'[anonymous]'):'[function]';
  const parents=new Map();for(const n of profile.nodes)for(const id of n.children||[])parents.set(id,n.id);
  const safeFrame=f=>{let url=f.url||'';if(url.startsWith('file://')){try{url=new URL(url).pathname;}catch{url='';}}return {name:safeName(f.functionName),file:url.startsWith(dir+'/')?url.slice(dir.length+1).split('?')[0]:url.startsWith('node:')?url:'[runtime]',line:f.lineNumber+1};};
  const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,count])=>{const f=nodes.get(id).callFrame;let ancestors=[],p=parents.get(id);for(let i=0;i<24&&p;i++,p=parents.get(p))ancestors.push(safeFrame(nodes.get(p).callFrame));return {...safeFrame(f),samples:count,ancestors};});
  return {appState,nativeZlibEnabled:enableNativeZlib,samples:profile.samples?.length||0,durationMs:(profile.endTime-profile.startTime)/1000,top};
 }finally{
  if(ws){if(opened){try{await post('Runtime.evaluate',{expression:"(typeof require==='function'?require:process.mainModule.require.bind(process.mainModule))('node:inspector').close()"},2500);}catch{}}try{ws.terminate();}catch{}}
  for(const p of pending.values())p.reject(Error('CLOSED'));pending.clear();
  if(opened){const remains=await list();if(remains)throw Error('INSPECTOR_CLEANUP_FAILED');}
 }
}
async function run(){const dir='/var/www/nenova-erp',rows=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:16*1024*1024})),app=rows.find(p=>p.name==='nenova-erp'&&p.pm2_env?.status==='online');if(!app?.pid)throw Error('APP_NOT_RUNNING');const WebSocket=require(dir+'/node_modules/next/dist/compiled/ws');const result=await captureLoginCpu(app.pid,dir,WebSocket,{enableNativeZlib:false});console.log(JSON.stringify({section:'login_cpu_profile',inspectorClosed:true,...result}));}
if(require.main===module||!require.main)run().catch(e=>{console.log(JSON.stringify({section:'login_cpu_profile',failed:true,code:/^[A-Z_]{1,40}$/.test(e.message)?e.message:'FAILED'}));process.exitCode=1;});
module.exports={captureLoginCpu};
