'use strict';
// 2026-10-22: ECOUNT 수집 직후 웹 작업본 자동 갱신 + RED 건너뛰기 + 합계 반올림 허용폭.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const vm=require('vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const policy=require('../lib/ecountWorkspacePolicy.cjs');

function loadStore(queryImpl){
  const src=read('lib/ecountWorkspaceStore.js').replace(/^import .*;\r?\n/gm,'').replace(/export async function /g,'async function ');
  const ctx={policy,crypto:require('crypto'),sql:{VarChar:()=>'v',NVarChar:()=>'n',Int:'i',UniqueIdentifier:'u',Char:()=>'c',DateTime2:'d',MAX:0},query:queryImpl,withTransaction:async()=>{throw new Error('no tx in this test');},effectiveAuthority:()=>null};
  vm.createContext(ctx);vm.runInContext(src+'\nthis.refreshFromLatest=refreshFromLatest;',ctx);return ctx;
}

test('refreshFromLatest: 기존 Head 마다 import-latest(IMPORT, 현재 revision) 호출, 화면별 실패는 격리', async()=>{
  const ctx=loadStore(async sqlText=>/OBJECT_ID/.test(sqlText)?{recordset:[{ready:1}]}:{recordset:[{menuId:'M1',program:'E040214',revision:3},{menuId:'M2',program:'E040214',revision:1}]});
  const calls=[];
  ctx.saveVersion=async(input,user)=>{calls.push({input,user});if(input.menuId==='M2'){const e=new Error('REVISION_CONFLICT');e.status=409;throw e;}return {revision:input.expectedRevision+1,idempotent:false};};
  const r=await ctx.refreshFromLatest('ar');
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>[c.input.action,c.input.reasonCode,c.input.expectedRevision]),[['import-latest','IMPORT',3],['import-latest','IMPORT',1]]);
  assert.equal(calls[0].user.userId,'ecount-auto-refresh');
  assert.equal(r.scopes[0].revision,4);assert.equal(r.scopes[1].error,'REVISION_CONFLICT');
});

test('refreshFromLatest: 수집 데이터셋(cash/ar/ap/sales) 밖은 건드리지 않는다', async()=>{
  let q=0;const ctx=loadStore(async()=>{q++;return {recordset:[]};});
  assert.equal((await ctx.refreshFromLatest('journal')).skipped,'NOT_SOURCE_DATASET');assert.equal(q,0);
});

test('latestSource 는 수집 검사 RED 스냅샷을 건너뛴다(직전 정상본 유지)', ()=>{
  assert.match(read('lib/ecountWorkspaceStore.js'),/FROM dbo\.WebEcountSnapshot WITH\(HOLDLOCK\) WHERE Dataset=@dataset AND VerifyStatus<>\\'RED\\' ORDER BY SnapshotKey DESC/);
});

test('ingest: RED 면 갱신하지 않고, 갱신 실패가 적재 성공을 뒤집지 않는다', ()=>{
  const s=read('pages/api/ecount/ingest.js');
  assert.match(s,/r\.status === 'RED'\) workspaceRefresh = \{ dataset, skipped: 'VERIFY_RED' \}/);
  assert.match(s,/try \{ workspaceRefresh = await refreshFromLatest\(dataset\); \} catch/);
});

test('합계 검사 허용폭 = max(1, 0.5×행수) — 채무 181행 2원 차(원 단위 반올림)는 GREEN', ()=>{
  const s=read('lib/ecountIngest.js');
  assert.match(s,/const tol = Math\.max\(1, 0\.5 \* dataRows\.length\);/);
  const tol=rows=>Math.max(1,0.5*rows);
  assert.ok(2<=tol(181));assert.ok(!(2<=tol(1)));
});
