import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as policy from '../lib/importPackingErpMatches.js';
import {readImportTeamRecord,writeImportTeamRecord} from '../lib/importTeamStore.js';
import {makeProductResolver,packingSourceKey} from '../lib/importPacking.js';

const rows=[{ProdKey:1,ProdName:'ROSE China Red 60cm',CounName:'중국',ProdCode:'R1',FlowerName:'장미',isDeleted:0},
 {ProdKey:2,ProdName:'ROSE China Red 70cm',CounName:'중국',isDeleted:0},
 {ProdKey:3,ProdName:'Deleted',CounName:'중국',isDeleted:1},
 {ProdKey:4,ProdName:'Other country',CounName:'콜롬비아',isDeleted:0},
 {ProdKey:5,ProdName:'Duplicate',CounName:'중국',isDeleted:0},
 {ProdKey:6,ProdName:'duplicate',CounName:'콜롬비아',isDeleted:0}];
const products=policy.packingErpProducts(rows);
const request={country:'CN',description:'Rose Red length 60cm',prodKey:1};

test('candidate and save scope: positive active product; deleted, wrong country, duplicate rejected',()=>{
 assert.equal(products.find(p=>p.ProdKey===1).selectable,true);
 assert.equal(products.find(p=>p.ProdKey===3),undefined);
 assert.equal(products.find(p=>p.ProdKey===5).selectable,false);
 const saved=policy.upsertPackingErpMatch(null,request,products);
 assert.equal(saved.entries[0].prodName,rows[0].ProdName);
 for(const prodKey of [0,3,4,5,999,'1'])assert.throws(()=>policy.upsertPackingErpMatch(null,{...request,prodKey},products));
 for(const country of ['',undefined,'??','CO'])assert.throws(()=>policy.upsertPackingErpMatch(null,{...request,country},products));
 assert.throws(()=>policy.upsertPackingErpMatch(null,{...request,description:''},products));
 assert.equal(policy.packingErpCatalog(products).items.length,3);
});

test('saved identity isolates country and length; stale/deleted identity cannot silently fuzzy rematch',()=>{
 let saved=policy.upsertPackingErpMatch(null,request,products);
 saved=policy.upsertPackingErpMatch(saved,{...request,description:'Rose Red length 70cm',prodKey:2},products);
 saved=policy.upsertPackingErpMatch(saved,{...request,country:'CO',prodKey:4},products);
 assert.equal(saved.entries.length,3);
 const cn=policy.packingErpAliases('CN',{},saved,products),co=policy.packingErpAliases('CO',{},saved,products);
 assert.equal(cn[saved.entries[0].sourceKey],rows[0].ProdName);
 assert.equal(co[saved.entries[0].sourceKey],'Other country');
 const stale=policy.packingErpAliases('CN',{},saved,products.filter(p=>p.ProdKey!==1));
 assert.match(stale[saved.entries[0].sourceKey],/REQUIRES_REVIEW/);
 const renamed=products.map(p=>p.ProdKey===1?{...p,ProdName:'Renamed'}:p);
 assert.match(policy.packingErpAliases('CN',{},saved,renamed)[saved.entries[0].sourceKey],/REQUIRES_REVIEW/);
});

test('web runtime mapping persists across reads with actor/change history and rejects CAS overwrite',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'packing-erp-match-'));
 try{
  const key=policy.PACKING_ERP_MATCH_KEY,actor={userId:'tester',userName:'테스트'};
  const value=policy.upsertPackingErpMatch(null,request,products);
  await writeImportTeamRecord(key,{value,expectedRevision:0,actor},{root});
  const loaded=await readImportTeamRecord(key,{root});
  assert.deepEqual(loaded.value,value);assert.equal(loaded.history[0].userId,'tester');
  assert.equal(loaded.history[0].changes[0].after.prodKey,1);
  const next=policy.upsertPackingErpMatch(value,{...request,prodKey:2},products);
  await assert.rejects(writeImportTeamRecord(key,{value:next,expectedRevision:0,actor},{root}),e=>e.statusCode===409);
  await writeImportTeamRecord(key,{value:next,expectedRevision:1,actor},{root});
  assert.equal((await readImportTeamRecord(key,{root})).history[1].changes[0].before.prodKey,1);
  await assert.rejects(writeImportTeamRecord(key,{value:null,expectedRevision:2,actor},{root}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Chinese/Korean source identity survives persistence and resolver cache without collision',()=>{
 const red='红玫瑰 [family:ROSE] [length:60CM]',white='白玫瑰 [family:ROSE] [length:60CM]';
 let saved=policy.upsertPackingErpMatch(null,{...request,description:red},products);
 saved=policy.upsertPackingErpMatch(saved,{...request,description:white,prodKey:2},products);
 assert.equal(saved.entries.length,2);
 assert.notEqual(packingSourceKey(red),packingSourceKey(white));
 assert.notEqual(packingSourceKey('빨강 장미'),packingSourceKey('흰 장미'));
 const resolver=makeProductResolver('CN',policy.packingErpCatalog(products),policy.packingErpAliases('CN',{},saved,products),{pending:[],noMatches:[]});
 assert.equal(resolver({description:red},0).matchedName,rows[0].ProdName);
 assert.equal(resolver({description:white},1).matchedName,rows[1].ProdName);
});

test('dedicated API uses the same SELECT scope for GET/POST; server owns name and actor',async()=>{
 let record={value:null,revision:0},calls=[],writes=[];
 let source=await fs.readFile(new URL('../pages/api/import/tools/product-matches.js',import.meta.url),'utf8');
 source=source.replace(/^import .*;\r?\n/gm,'').replace('export const config','const config').replace('export default','globalThis.handler =');
 const sandbox={...policy,withAuth:f=>f,query:async sql=>{calls.push(sql);return{recordset:rows};},
  readImportTeamRecord:async()=>record,writeImportTeamRecord:async(key,arg)=>{writes.push({key,...arg});record={value:arg.value,revision:1};return record;}};
 vm.runInNewContext(source,sandbox);
 const invoke=async(method,body,user={userId:'real-user'})=>{
  let code=200,data;const res={setHeader(){},status(n){code=n;return this;},json(x){data=x;return this;}};
  await sandbox.handler({method,body,user},res);return{code,data};
 };
 assert.equal((await invoke('GET')).code,200);
 assert.equal((await invoke('POST',{...request,prodName:'forged',expectedRevision:0,userId:'fake'})).code,200);
 assert.equal(writes[0].actor.userId,'real-user');assert.equal(writes[0].value.entries[0].prodName,rows[0].ProdName);
 assert(calls.every(sql=>sql===policy.PACKING_PRODUCT_SCOPE_SQL));
 assert.doesNotMatch(calls.join(' '),/\b(INSERT|UPDATE|DELETE|EXEC)\b/i);
 assert.equal((await invoke('POST',{...request})).code,400);
 assert.equal((await invoke('POST',{...request,prodKey:4,expectedRevision:1})).code,400);
 assert.equal((await invoke('GET',null,{accountActive:false})).code,403);
 assert.equal((await invoke('DELETE')).code,405);
 assert.equal(writes.length,1);
 const state=await fs.readFile(new URL('../pages/api/import/tools/state.js',import.meta.url),'utf8');
 assert.match(state,/req.query.key==='packing.erp-matches'.*403/);
});
