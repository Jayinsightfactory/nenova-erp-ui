import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arrivalDriveTiming, resolveArrivalDriveSelection } from '../lib/arrivalDrivePolicy.js';
import { isOrbitReportViewer } from '../lib/orbitReportAccess.js';

const source = { id:'file-a', sha:'hash-a', year:'2026', week:'38-1', country:'태국', filename:'38-1 태국 원가.xlsx', uploadedAt:new Date().toISOString() };
const selection = Object.fromEntries(['id','sha','year','week','country'].map(k=>[k,source[k]]));
const config = { enabled:true, year:'2026', countries:['태국','중국'] };
assert.equal(resolveArrivalDriveSelection([source],config,selection),source);
assert.equal(arrivalDriveTiming(source).ready,false);
for(const k of ['id','sha','year','week','country']) {
  assert.throws(()=>resolveArrivalDriveSelection([source],config,{...selection,[k]:'different'}));
  assert.throws(()=>resolveArrivalDriveSelection([source],config,{...selection,[k]:''}));
}
for(const c of [{...config,enabled:false},{...config,year:'2025'},{...config,countries:[]}]) assert.throws(()=>resolveArrivalDriveSelection([source],c,selection));
assert.throws(()=>resolveArrivalDriveSelection([{...source,reason:'파일군 충돌'}],config,selection),/충돌/);
assert.throws(()=>resolveArrivalDriveSelection([{...source,uploadedAt:''}],config,selection),/등록시각/);

const text=fs.readFileSync(new URL('../lib/arrivalDriveAuto.js',import.meta.url),'utf8');
const body=text.slice(text.indexOf('export async function runArrivalDriveAuto'),text.indexOf('export function startArrivalDriveScheduler')).replace('export ','');
function fixture({changeLatest=false,failSave=false}={}) {
  let state={}, saves=[], reads=0, candidates=0;
  const lock={};
  const deps={ global:lock, arrivalDriveConfig:()=>config,
    selectArrivalDriveCandidates:()=>{ candidates++; return changeLatest&&candidates>1?[{...source,sha:'new'}]:[source,{...source,id:'other',sha:'other',country:'중국'}]; },
    listVisible:()=>[], actor:{userId:'automatic'}, read:()=>state, stateFile:s=>s.sha,
    arrivalDriveTiming, resolveArrivalDriveSelection, write:(_,s)=>{state=s;},
    getFile:()=>{reads++;return {abs:'fixture'};},fs:{readFileSync:()=>Buffer.from('fixture')},
    crypto:{createHash:()=>({update:()=>({digest:()=>source.sha})})},query:async()=>({recordset:[]}),
    scopeArrivalDriveRows:p=>p, parseArrivalCostWorkbook:()=>({rows:[{orderYear:'2026',orderWeek:'38-1'}],unmatchedCount:1}),loadMappings:()=>({}),
    createArrivalCostImport:async input=>{if(failSave)throw Error('수동 등록 현재본 보류');saves.push(input);return {importKey:12};}
  };
  return {run:new Function(...Object.keys(deps),`${body};return runArrivalDriveAuto;`)(...Object.values(deps)),get:()=>({state,saves,reads}),lock};
}
let f=fixture();await f.run();assert.equal(f.get().reads,0);
await f.run({selection,user:{userId:'nenovaSS3'}});
assert.equal(f.get().saves.length,1);assert.equal(f.get().state.status,'complete');
assert.equal(f.get().saves[0].driveSource.executionMode,'manual-now');
assert.equal(f.get().saves[0].user.userId,'nenovaSS3');
assert.equal(f.get().saves[0].driveSource.uploadedAt,source.uploadedAt);
await f.run({selection,user:{userId:'nenovaSS3'}});assert.equal(f.get().saves.length,1);
f=fixture({changeLatest:true});await f.run({selection,user:{userId:'nenovaSS3'}});assert.equal(f.get().saves.length,0);assert.equal(f.get().state.status,'review');
f=fixture({failSave:true});await f.run({selection,user:{userId:'nenovaSS3'}});assert.equal(f.get().state.status,'review');assert.equal(f.get().saves.length,0);
f=fixture();f.lock._arrivalDriveRunning=true;await assert.rejects(f.run({selection,user:{userId:'nenovaSS3'}}),/처리 중/);
await assert.rejects(f.run({selection}),/담당자/);

const apiText=fs.readFileSync(new URL('../pages/api/arrival-cost/drive-auto.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default','return');
let calls=0,configSaves=0;
const handler=new Function('withAuth','isOrbitReportViewer','arrivalDriveStatus','saveArrivalDriveConfig','runArrivalDriveAuto',apiText)(h=>h,isOrbitReportViewer,()=>({results:[]}),()=>configSaves++,async()=>calls++);
const response=()=>({code:200,status(n){this.code=n;return this;},json(v){this.value=v;return this;},setHeader(){},end(){}});
for(const user of [{userId:'sales'},null]) {const res=response();await handler({user,method:'POST',body:{action:'run-now',confirm:true,selection}},res);assert.equal(res.code,403);}
for(const confirm of [false,undefined,0,'true']) {const res=response();await handler({user:{userId:'nenovaSS3'},method:'POST',body:{action:'run-now',confirm,selection}},res);assert.equal(res.code,400);}
let res=response();await handler({user:{userId:'NENOVASS3'},method:'POST',body:{action:'run-now',confirm:true,selection}},res);assert.equal(calls,1);assert.equal(configSaves,0);
res=response();await handler({user:{userId:'nenovaSS3'},method:'POST',body:{action:'unknown'}},res);assert.equal(res.code,400);
console.log('arrival run-now: exact selected version/year, 24h default, admin confirmation, stale source, one-file scope, duplicate and protected failure passed');
