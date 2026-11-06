// One canonical weekly SELECT-only read, ephemeral loader instrumentation only.
// No source payloads, parameters, SQL text, notes, credentials or exception messages logged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{register}=require('node:module');
const {pathToFileURL}=require('node:url');
async function main(){
 require('@next/env').loadEnvConfig(process.env.PROFIT_ENV_DIR||process.cwd(),false,{info(){},error(){}});
 const year=String(process.env.PROBE_YEAR||'2026'),week=String(process.env.PROBE_WEEK||'44').padStart(2,'0');
 if(!/^20\d{2}$/.test(year)||!/^\d{2}$/.test(week)||+week<1||+week>53)throw Error('PROFILE_SCOPE_INVALID');
 const start=Date.now(),groups=new Map(),calls=new Map(),results=[];let count=0,peakRss=0,peakHeap=0;
 const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const functionIds=new WeakMap();let nextFunctionId=0;
 function stable(value){if(value===undefined)return ['undefined'];if(value===null)return ['null'];if(Array.isArray(value))return ['array',value.map(stable)];if(typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,stable(value[k])])];if(typeof value==='function'){if(!functionIds.has(value))functionIds.set(value,++nextFunctionId);return ['function',functionIds.get(value)];}return [typeof value,String(value)];}
 globalThis.__profitProfileCall=(name,args)=>{const byKey=calls.get(name)||new Map();calls.set(name,byKey);const key=digest(stable(args));byKey.set(key,(byKey.get(key)||0)+1);};
 globalThis.__profitProfileResult=(name,result)=>results.push({name,result,hash:digest(result)});
 function memory(){const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);return {rssMB:+(m.rss/1048576).toFixed(2),heapMB:+(m.heapUsed/1048576).toFixed(2)};}
 globalThis.__profitProfileStage=stage=>console.log(JSON.stringify({stage,elapsedMs:Date.now()-start,queries:count,...memory()}));
 const instrumenter=path.resolve('scripts/lib/profit-profile-instrumentation.cjs');
 register('data:text/javascript,'+encodeURIComponent(`
  import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
  const require=createRequire(${JSON.stringify(pathToFileURL(__filename).href)});
  const {instrumentProfileSource}=require(${JSON.stringify(instrumenter)});
  export async function resolve(spec,ctx,next){try{return await next(spec,ctx);}catch(e){if(spec.startsWith('.'))for(const ext of ['.js','/index.js']){try{return await next(spec+ext,ctx);}catch{}}throw e;}}
  export async function load(url,ctx,next){
   if(url.endsWith('.json'))return {format:'json',source:fs.readFileSync(fileURLToPath(url)),shortCircuit:true};
   const result=await next(url,ctx);if(result.format==='module'&&result.source){return {...result,source:instrumentProfileSource(String(result.source),url)};}return result;
  }
 `));
 const {sql,getPool}=await import('../lib/db.js');
 const original=sql.Request.prototype.query;
 sql.Request.prototype.query=function(statement,...args){
  const text=String(statement),clean=text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ').trim();
  if(!/^(SELECT|WITH)\b/i.test(clean)||/\b(INSERT|UPDATE|DELETE|EXEC|MERGE|ALTER|CREATE|DROP)\b/i.test(clean))throw Error('PROFILE_SELECT_ONLY');
  const normalized=clean.replace(/\s+/g,' ').replace(/\bIN\s*\([\d,\s]+\)/gi,'IN(<keys>)');
  const hash=crypto.createHash('sha256').update(normalized).digest('hex').slice(0,12),tag=text.match(/\/\*\s*([a-z][a-z0-9:_-]{1,80})\s*\*\//i)?.[1]||null;
  const group=groups.get(hash)||{hash,tag,tables:[...clean.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].slice(0,3).map(m=>m[1]),count:0,totalMs:0,maxMs:0,failures:0};groups.set(hash,group);group.count++;count++;
  const at=Date.now();const done=()=>{const elapsed=Date.now()-at;group.totalMs+=elapsed;group.maxMs=Math.max(group.maxMs,elapsed);memory();};
  return original.call(this,statement,...args).then(result=>{done();return result;},error=>{group.failures++;done();throw error;});
 };
 sql.Request.prototype.batch=sql.Request.prototype.execute=()=>{throw Error('PROFILE_SELECT_ONLY');};
 try{
  globalThis.__profitProfileStage('canonical:start');
  const {loadWeeklyReportPayload}=await import('../pages/api/sales/profit-report.js');
  const data=await loadWeeklyReportPayload(week,year);
  globalThis.__profitProfileStage('canonical:end');
  const moneyHash=digest({rows:data.rows?.map(row=>({key:row.key,category:row.category,calc:row.calc})),totals:data.totals});
  console.log(JSON.stringify({result:'PASS',elapsedMs:Date.now()-start,queries:count,basis:data.financialReadPolicy?.basis,moneyHash,argumentGroups:[...calls].map(([name,keys])=>({name,calls:[...keys.values()].reduce((a,b)=>a+b,0),unique:keys.size,duplicates:[...keys.values()].reduce((a,b)=>a+b-1,0),maxRepeats:Math.max(...keys.values())})),resultMutations:results.filter(r=>digest(r.result)!==r.hash).length,peakRssMB:+(peakRss/1048576).toFixed(2),peakHeapMB:+(peakHeap/1048576).toFixed(2),groups:[...groups.values()].sort((a,b)=>b.totalMs-a.totalMs).slice(0,35)}));
 }finally{await (await getPool()).close();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({result:'FAIL',code:error.code||error.name}));process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
