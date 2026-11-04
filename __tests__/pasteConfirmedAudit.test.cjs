const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {confirmedOperation,readSavedAnalyses}=require('../scripts/paste-confirmed-audit.cjs');
const payload={schema:'paste-operation-v1',year:'2026',week:'2026-44-01',verified:true,preflightOnly:false,incomplete:false,committedCount:1,entries:[{type:'ADD',custKey:1,prodKey:2,qty:1,unit:'박스',sourceIdentity:'nenovakakao|fixture|1'}]};
const row=p=>({ActionType:'SHIPMENT_ADJUST_BATCH',Result:'SUCCESS',LogKey:1,ActionDtm:'2026-11-04T10:00:00',Payload:JSON.stringify(p)});
test('truth requires fully committed complete source scope, never preview or guessed year',()=>{
 assert(confirmedOperation(row(payload)));for(const p of [{...payload,verified:false},{...payload,committedCount:0},{...payload,year:'2025'},{...payload,week:'2026-99-01'},{...payload,preflightOnly:true},{...payload,incomplete:true},{...payload,entries:[...payload.entries,{...payload.entries[0],sourceIdentity:'nenovakakao|fixture|2'}],committedCount:2}])assert.equal(confirmedOperation(row(p)),null);
});
test('cached predictions require exact source/year integrity, not ground truth',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paste-audit-test-'));try{fs.mkdirSync(path.join(root,'shared'));for(const year of ['2025','2026']){const identity=JSON.stringify(['year-source-v2',year,'검증 원문']),name=crypto.createHash('sha256').update(identity).digest('hex')+'.json';fs.writeFileSync(path.join(root,'shared',name),JSON.stringify({version:2,identity,savedAt:1,data:{success:true,orders:[]}}));}
 fs.writeFileSync(path.join(root,'shared','a'.repeat(64)+'.json'),JSON.stringify({version:2,identity:'bad'}));const result=readSavedAnalyses(root);assert.equal(result.records.size,2);assert.equal(result.invalid,1);
 }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('paste-audit-test-'));fs.rmSync(root,{recursive:true,force:true});}
});
test('diagnostic workflow excludes deployment and never prints raw confirmed data',()=>{const s=fs.readFileSync('.github/workflows/deploy.yml','utf8');assert.match(s,/inputs.diagnose_paste_only != true/);assert.match(s,/inputs.diagnose_paste_only == true/);const code=fs.readFileSync('scripts/paste-confirmed-audit.cjs','utf8');assert.doesNotMatch(code,/console\.log\([^\n]*(?:Payload|\.text|\.entries|API_KEY|PASSWORD)/);assert.doesNotMatch(code,/\b(?:INSERT INTO|UPDATE dbo|DELETE FROM|MERGE INTO)\b/i);});
