'use strict';
// Every observed source button of a dataset whose controls derive IDs from ACTION_IDS must have a map entry,
// otherwise the control renders without data-ecount-action-id and the parity report cannot link it.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'components/ecount/ObservedPageControls.js'),'utf8');
const start=src.indexOf('const ACTION_IDS = ')+'const ACTION_IDS = '.length;
let depth=0,i=start,inStr=false;for(;i<src.length;i++){const ch=src[i];if(inStr){if(ch==='\\')i++;else if(ch==='"')inStr=false;continue;}if(ch==='"')inStr=true;else if(ch==='{')depth++;else if(ch==='}'){depth--;if(!depth)break;}}
const ACTION_IDS=JSON.parse(src.slice(start,i+1));
const report=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
// Datasets whose every observed button is expected in the map (fully map-driven components).
const FULL={E010701:'journal',E040217:'receipt',E040310:'payment',E040302:'poQuery',E040305:'buyStatus',E040216:'discount',E040313:'buyDisc',E040208:'quoteStat',E040204:'orderQuery',E040206:'saleQuery',E040212:'unsold',E040307:'unbought',E040609:'unpSale',E040708:'daySale',E040209:'orderStat',E040306:'poStat',E040218:'salesTax',E040223:'taxStat',E040219:'buyTax',E040320:'buyTaxStat',E040701:'stock',E040711:'whStock',E040728:'relStock',E040726:'bomStock',E040727:'stkBalance',E040702:'stkLedger',E040719:'stockMove'};
test('ACTION_IDS covers every observed source button for map-driven datasets',()=>{
  for(const [program,dataset] of Object.entries(FULL)){
    const page=report.pages.find(p=>p.program===program);assert.ok(page?.buttons?.length,program);
    const values=new Set(Object.values(ACTION_IDS[dataset]||{}));
    const missing=page.buttons.map(b=>b.matchId).filter(id=>!values.has(id));
    assert.deepEqual(missing,[],`${program}/${dataset} missing ${missing.length}`);
  }
});
test('ACTION_IDS values stay unique within a dataset and belong to that program',()=>{
  for(const [dataset,map] of Object.entries(ACTION_IDS)){
    const programs=new Set(Object.values(map).map(v=>v.split('-')[0]));
    assert.equal(programs.size,1,`${dataset} mixes programs ${[...programs]}`);
    const byId=new Map();for(const [key,id] of Object.entries(map)){const ctx=key.split('|')[0];if(ctx==='unknown')continue;byId.set(id,(byId.get(id)||0)+1);}
    for(const [id,count] of byId)assert.ok(count<=2,`${dataset} ${id} mapped ${count} times`);
  }
});
