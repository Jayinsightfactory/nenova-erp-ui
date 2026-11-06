// Isolated synthetic Next build: no application source injection, DB, credentials or production diagnostics.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),inputs=['lib/profitLatestInFlight.mjs','lib/erpReadContext.js','pages/api/sales/profit-report.js'];
const hashes=()=>inputs.map(p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex'));
const before=hashes(),base=path.join(ROOT,'.verify');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'singleflight-built-'));
const put=(p,s)=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),s);};
const route=`import {shareLatestProfitRead} from '../../lib/profitLatestInFlight.mjs';
import {withErpReadContext} from '../../lib/erpReadContext.js';
export default async function handler(req,res){
 const key=Symbol.for('nenova.synthetic.singleflight.state'),state=globalThis[key]??={calls:0};
 const read=async()=>{state.calls++;await new Promise(r=>setTimeout(r,400));if(req.query.fail==='1')throw Error('synthetic');return {rows:[{calc:{C:10,J:4}}],totals:{C:10,J:4}};};
 const work=()=>shareLatestProfitRead(req.query.year??'2026',req.query.week??'44',read);
 try{const result=req.query.ctx==='1'?await withErpReadContext({queryFn:async()=>{throw Error('NO_SQL');}},work):await work();
 const money=JSON.stringify(result);if(req.query.mutate==='1')result.rows[0].calc.C=99;
 res.status(200).json({money,result,calls:state.calls,size:globalThis[Symbol.for('nenova.profit.coherent-live.inflight.v1')]?.size??0});
 }catch{res.status(503).json({calls:state.calls,size:globalThis[Symbol.for('nenova.profit.coherent-live.inflight.v1')]?.size??0});}
}`;
put('package.json',JSON.stringify({name:'synthetic-singleflight',private:true}));
put('next.config.js',"module.exports={distDir:process.env.NEXT_DIST_DIR,experimental:{cpus:1},poweredByHeader:false};");
for(const p of inputs.slice(0,2))put(p,fs.readFileSync(path.join(ROOT,p),'utf8'));
put('pages/api/main.js',route);put('pages/api/notes.js',route);
fs.symlinkSync(path.dirname(require.resolve('next/package.json',{paths:[ROOT]})).replace(/[\\/]next$/,''),path.join(dir,'node_modules'),'junction');
const env={...process.env,NEXT_DIST_DIR:'.next-synthetic',NEXT_TELEMETRY_DISABLED:'1',DB_SERVER:'',NENOVA_BUILD_WORKERS:'1',CIRCLE_NODE_TOTAL:'2'};
const cli=require.resolve('next/dist/bin/next',{paths:[ROOT]});
async function command(args){return new Promise((resolve,reject)=>{const child=cp.spawn(process.execPath,[cli,...args],{cwd:dir,env,stdio:['ignore','pipe','pipe'],windowsHide:true});let text='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{text=(text+b).slice(-12000);});child.on('exit',code=>code===0?resolve():reject(Error('SYNTHETIC_BUILD_FAILED')));});}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){let server;
 try{
  await command(['build','--webpack']);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'.next-synthetic/server/pages-manifest.json'),'utf8'));
  assert.notEqual(manifest['/api/main'],manifest['/api/notes'],'different compiled API bundles required');
  const port=await freePort(),url='http://127.0.0.1:'+port;
  server=cp.spawn(process.execPath,[cli,'start','-H','127.0.0.1','-p',String(port)],{cwd:dir,env,stdio:'ignore',windowsHide:true});
  for(let i=0;i<120;i++){try{await fetch(url+'/404');break;}catch{await new Promise(r=>setTimeout(r,250));}if(i===119)throw Error('SYNTHETIC_START_FAILED');}
  const get=async(p)=>{const r=await fetch(url+p);return {status:r.status,...await r.json()};};
  const [a,b]=await Promise.all([get('/api/main?mutate=1'),get('/api/notes')]);
  assert.equal(a.calls,1);assert.equal(b.calls,1);assert.equal(a.money,b.money);assert.equal(a.result.rows[0].calc.C,99);assert.equal(b.result.rows[0].calc.C,10);assert.equal(b.size,0);
  const owner=http.get(url+'/api/main');owner.on('error',()=>{});await new Promise(r=>setTimeout(r,100));
  const waiter=get('/api/notes');owner.destroy();const w=await waiter;assert.equal(w.status,200);assert.equal(w.calls,2);assert.equal(w.money,b.money);assert.equal(w.size,0);
  const [f,g]=await Promise.all([get('/api/main?fail=1'),get('/api/notes?fail=1')]);assert.equal(f.status,503);assert.equal(g.status,503);assert.equal(g.calls,3);assert.equal(g.size,0);
  assert.equal((await get('/api/notes')).calls,4,'failure evicted');
  const [y,z]=await Promise.all([get('/api/main?year=2025'),get('/api/notes?year=2026')]);assert.equal(Math.max(y.calls,z.calls),6);
  const [c,d]=await Promise.all([get('/api/main?ctx=1'),get('/api/notes?ctx=1')]);assert.equal(Math.max(c.calls,d.calls),8,'active contexts do not join');
  assert.deepEqual(hashes(),before,'original source never injected or changed');
  console.log(JSON.stringify({status:'PASS',synthetic:true,differentApiBundles:2,ownerHttpAborted:true,waiterStatus:200,sourceReadsForOverlap:1,mutationIsolation:true,contextBypass:true,failureEvicted:true,sourceUnchanged:true,dbReads:0,dbWrites:0,distDir:'.next-synthetic'}));
 }finally{if(server&&server.exitCode===null&&server.signalCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill();await stopped;}assert.deepEqual(hashes(),before);}
}
main().catch(()=>{console.error(JSON.stringify({status:'FAIL',code:'SYNTHETIC_SINGLEFLIGHT_FAILED',sourceUnchanged:JSON.stringify(hashes())===JSON.stringify(before)}));process.exitCode=1;});
