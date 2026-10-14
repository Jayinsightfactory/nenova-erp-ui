import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as policy from '../lib/importPackingErpMatches.js';
import {readImportTeamRecord,writeImportTeamRecord} from '../lib/importTeamStore.js';
import {makeProductResolver} from '../lib/importPacking.js';

test('A/B sessions share one team record; revision-only never queries SQL; stale CAS leaves bytes unchanged',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'packing-team-refresh-'));
  try {
    const rows=[{ProdKey:1,ProdName:'ROSE RED 60cm',CounName:'중국',isDeleted:0}];
    let sqlReads=0;
    let source=await fs.readFile(new URL('../pages/api/import/tools/product-matches.js',import.meta.url),'utf8');
    source=source.replace(/^import .*;\r?\n/gm,'').replace('export const config','const config').replace('export default','globalThis.handler =');
    const sandbox={...policy,withAuth:fn=>fn,query:async()=>{sqlReads++;return{recordset:rows};},
      readImportTeamRecord:key=>readImportTeamRecord(key,{root}),
      writeImportTeamRecord:(key,input)=>writeImportTeamRecord(key,input,{root})};
    vm.runInNewContext(source,sandbox);
    const invoke=async(userId,method='GET',body,query={})=>{
      let status=200,data;
      const res={setHeader(){},status(value){status=value;return this;},json(value){data=value;return this;}};
      await sandbox.handler({method,body,query,user:{userId}},res);
      return{status,data};
    };
    const initial=await invoke('B','GET',undefined,{revisionOnly:'1'});
    assert.equal(initial.data.scope,'team');assert.equal(initial.data.revision,0);assert.equal(sqlReads,0);
    const body={country:'CN',description:'红玫瑰 60cm',prodKey:1,expectedRevision:0};
    assert.equal((await invoke('A','POST',body)).status,200);
    const b=await invoke('B');
    assert.equal(b.data.revision,1);assert.equal(b.data.value.entries[0].prodKey,1);assert.equal(b.data.scope,'team');
    // A different operator's next upload rebuilds its resolver from the durable
    // team read, not from the first browser's in-memory selection.
    const resolver=makeProductResolver('CN',policy.packingErpCatalog(b.data.products),
      policy.packingErpAliases('CN',{},b.data.value,b.data.products),{pending:[],noMatches:[]});
    const nextUpload=resolver({description:body.description},0);
    assert.equal(nextUpload.matchedName,'ROSE RED 60cm');
    assert.notEqual(nextUpload.unmatched,true);
    const files=(await fs.readdir(root)).filter(name=>name.endsWith('.json'));
    const before=await Promise.all(files.map(name=>fs.readFile(path.join(root,name),'utf8')));
    assert.equal((await invoke('B','POST',body)).status,409);
    const after=await Promise.all(files.map(name=>fs.readFile(path.join(root,name),'utf8')));
    assert.deepEqual(after,before);
    const reads=sqlReads;
    const revision=await invoke('B','GET',undefined,{revisionOnly:'1'});
    assert.equal(revision.data.revision,1);assert.equal(sqlReads,reads);
    assert.equal(revision.data.products,undefined);
    const stored=await readImportTeamRecord(policy.PACKING_ERP_MATCH_KEY,{root});
    assert.equal(stored.history.length,1);assert.equal(stored.history[0].userId,'A');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
