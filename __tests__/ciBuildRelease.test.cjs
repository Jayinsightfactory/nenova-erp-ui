const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pack,stage,validateEntries}=require('../scripts/ci-build-release.cjs');
const commit='a'.repeat(40);
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-release-'));
  fs.mkdirSync(path.join(root,'.next-build/server'),{recursive:true});
  fs.mkdirSync(path.join(root,'.next-build/cache'),{recursive:true});
  fs.mkdirSync(path.join(root,'data/generated'),{recursive:true});
  fs.mkdirSync(path.join(root,'.next'),{recursive:true});
  fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'live-old');
  fs.writeFileSync(path.join(root,'.next-build/BUILD_ID'),'new');
  fs.writeFileSync(path.join(root,'.next-build/server/page.js'),'built');
  fs.writeFileSync(path.join(root,'.next-build/cache/excluded'),'cache');
  fs.writeFileSync(path.join(root,'package-lock.json'),'{}');
  for(const name of ['full-development-history.json','menu-development-history.json'])fs.writeFileSync(path.join(root,'data/generated',name),'[]');
  const archive=path.join(root,'release.tar.gz');pack(root,archive,commit);
  return {root,archive};
}
test('verified release stages without replacing live build and preserves generated data backup',()=>{
  const {root,archive}=fixture();try{
    stage(root,archive,commit,path.join(root,'backups'));
    assert.equal(fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8'),'live-old');
    assert.equal(fs.readFileSync(path.join(root,'.next-build/BUILD_ID'),'utf8'),'new');
    assert(!fs.existsSync(path.join(root,'.next-build/cache')));
    assert.equal(fs.readdirSync(path.join(root,'backups')).length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
for(const failure of ['checksum','commit','lock'])test(`reject ${failure} before replacing staged or live files`,()=>{
  const {root,archive}=fixture();try{
    if(failure==='checksum')fs.appendFileSync(archive,'broken');
    if(failure==='lock')fs.writeFileSync(path.join(root,'package-lock.json'),'{"changed":true}');
    assert.throws(()=>stage(root,archive,failure==='commit'?'b'.repeat(40):commit,path.join(root,'backups')),/mismatch/);
    assert.equal(fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8'),'live-old');
    assert(fs.existsSync(path.join(root,'.next-build/cache/excluded')));
    assert(!fs.existsSync(path.join(root,'backups')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('archive paths and links cannot escape the staging directory',()=>{
  validateEntries('.next-build/server/page.js\n','-rw-r--r-- 0 0 0 file\n');
  for(const entry of ['/etc/passwd','.next-build/../../.env.local','.env.local','.next-build\\..\\.env'])assert.throws(()=>validateEntries(entry,'-rw-r--r-- file'),/Unsafe/);
  assert.throws(()=>validateEntries('.next-build/link','lrwxrwxrwx link -> /etc'),/links/);
});
