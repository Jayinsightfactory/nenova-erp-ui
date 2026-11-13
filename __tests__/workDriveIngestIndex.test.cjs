'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createIngestIndexReader}=require('../lib/workDriveIngestIndex.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-ingest-index-'));t.after(()=>{assert.ok(dir.startsWith(path.join(os.tmpdir(),'nenova-ingest-index-')));fs.rmSync(dir,{recursive:true,force:true});});return path.join(dir,'index.jsonl');}
const line=r=>JSON.stringify(r)+'\n';
function expected(rows){const files=rows.filter(r=>r&&r.type!=='download'),latest=new Map(files.map(r=>[r.id,r]));return {used:[...latest.values()].filter(r=>!r.deleted).reduce((n,r)=>n+(r.size||0),0),dup:sha=>files.find(r=>r.sha===sha)?.id,count:(name,owner)=>files.filter(r=>!r.deleted&&r.filename===name&&r.uploaderName===owner).length};}
test('matches historical duplicate/version and latest quota through local appends without reparsing',t=>{
 const file=fixture(t),reader=createIngestIndexReader(),rows=[];
 fs.writeFileSync(file,'');reader.read(file);
 const additions=[{id:'a',sha:'old',filename:'한글.xlsx',uploaderName:'staff',size:10},{id:'a',sha:'old',filename:'한글.xlsx',uploaderName:'staff',size:10,deleted:true},{id:'b',sha:'new',filename:'한글.xlsx',uploaderName:'staff',size:20},{type:'download',id:'log',size:999},{id:'b',sha:'new',filename:'한글.xlsx',uploaderName:'staff',size:21}];
 for(const r of additions){const before=reader.beforeAppend(file),text=line(r);fs.appendFileSync(file,text);reader.appended(file,r,before,Buffer.byteLength(text));rows.push(r);const actual=reader.read(file),want=expected(rows);assert.equal(actual.used,want.used);assert.equal(actual.duplicate('old')?.id,want.dup('old'));assert.equal(actual.versionCount('한글.xlsx','staff'),want.count('한글.xlsx','staff'));}
 assert.equal(reader.stats().parses,1);const duplicate=reader.read(file).duplicate('old');duplicate.id='changed';assert.equal(reader.read(file).duplicate('old').id,'a');
});
test('external append, same-size replacement, truncation and deletion invalidate cached state',t=>{
 const file=fixture(t),reader=createIngestIndexReader();const a={id:'a',sha:'aaa',size:12};fs.writeFileSync(file,line(a));assert.equal(reader.read(file).used,12);
 fs.appendFileSync(file,line({...a,id:'b',sha:'bbb',size:13}));assert.equal(reader.read(file).used,25);
 const replacement=file+'.new';fs.writeFileSync(replacement,line({...a,sha:'zzz'}));fs.renameSync(replacement,file);assert.equal(reader.read(file).duplicate('aaa'),null);assert.equal(reader.read(file).duplicate('zzz').id,'a');
 fs.truncateSync(file,0);assert.equal(reader.read(file).used,0);fs.unlinkSync(file);assert.equal(reader.read(file).used,0);
});
test('concurrent external append invalidates local hook; malformed and unsupported legacy data preserve fallback',t=>{
 const file=fixture(t),reader=createIngestIndexReader();fs.writeFileSync(file,'{broken\n'+line({id:'a',size:1}));assert.equal(reader.read(file).used,1);
 const before=reader.beforeAppend(file),r={id:'b',size:2},text=line(r);fs.appendFileSync(file,line({id:'c',size:4})+text);reader.appended(file,r,before,Buffer.byteLength(text));assert.equal(reader.read(file).used,7);
 fs.appendFileSync(file,line({id:'legacy',size:'8'}));assert.equal(reader.read(file),null);assert.equal(reader.stats().files,0);
});
test('large index is parsed once across repeated ingest reads, without retaining full audit rows',t=>{
 const file=fixture(t),reader=createIngestIndexReader();fs.writeFileSync(file,Array.from({length:18000},(_,i)=>line({id:'id'+i,sha:'sha'+i,size:100,filename:'book.xlsx',uploaderName:'staff',audit:'x'.repeat(400)})).join(''));
 const view=reader.read(file);for(let i=0;i<100;i++)assert.equal(reader.read(file).used,1800000);assert.equal(view.versionCount('book.xlsx','staff'),18000);assert.equal(reader.stats().parses,1);
});
