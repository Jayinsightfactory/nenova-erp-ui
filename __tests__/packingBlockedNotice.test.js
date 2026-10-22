const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
async function reviewExports(){
 const filename=path.resolve(__dirname,'../components/import-tools/PackingEvidenceReview.js');
 const source=fs.readFileSync(filename,'utf8'),loaded=new Map();
 // SWC compiles the component to CJS. Resolve its ESM helpers sequentially first
 // so Node 20 cannot synchronously require a dependency still being imported.
 for(const match of source.matchAll(/from ['"](\.\.\/\.\.\/lib\/[^'"]+)['"]/g)){
  if(!match[1].includes('importPackingPdfPreview')) loaded.set(match[1],await import(require('node:url').pathToFileURL(path.resolve(path.dirname(filename),match[1])).href));
 }
 const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
 m.require=id=>id.endsWith('.css')?{}:id.includes('importPackingPdfPreview')?{}:loaded.has(id)?loaded.get(id):require(id);
 m._compile(transformSync(source,{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);
 return m.exports;
}
test('printed date has no mandatory reason; explicit invalid date still explains the error in either year',async()=>{
 const {validateDrafts}=await reviewExports();const {packingReviewErrorSummary}=await import('../lib/packingBlockedNotice.js');
 for(const year of [2025,2026]){
 const baseline=new Map([['0',{values:{gw:'',cw:'',freight:''},metadata:{values:{date:''},issueFields:['date']}}]]);
 const draft={invoiceIndex:0,values:{gw:'',cw:'',freight:''},reason:'',metadata:{values:{date:`${year}-10-10`},reasons:{},confirmed:{}}};
 assert.deepEqual(validateDrafts([draft],baseline,false),{});
 draft.metadata.reasons.date='원문 날짜 확인';assert.deepEqual(validateDrafts([draft],baseline,false),{});
 draft.metadata.values.date=`${year}-02-30`;assert.match(packingReviewErrorSummary(validateDrafts([draft],baseline,false)),/실제로 존재하는/);
 }
 assert.equal(packingReviewErrorSummary({}),'');
});
test('popup shows exact same explanation and has no persistence side effects',async()=>{
 const {notifyPackingBlocked}=await import('../lib/packingBlockedNotice.js');let message;
 global.window={alert:value=>{message=value;}};
 try{notifyPackingBlocked('금액을 확인하세요');assert.equal(message,'금액을 확인하세요');}finally{delete global.window;}
 assert.doesNotThrow(()=>notifyPackingBlocked('server render'));
});
