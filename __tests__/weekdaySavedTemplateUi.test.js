const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const source=fs.readFileSync('components/WeekdayEstimateWorkspace.js','utf8');
const suffix=process.platform==='win32'?'-msvc':process.platform==='linux'?'-gnu':'';
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
transformSync(source,false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));
const helper=source.slice(source.indexOf('export async function loadWeekdaySavedTemplate'),source.indexOf('export default function WeekdayEstimateWorkspace'));
const load=new Function(helper.replace('export async function','async function')+';return loadWeekdaySavedTemplate;')();
const result={success:true,custKey:533,fileName:'주광.xlsx',sha256:'a'.repeat(64),base64:'eA==',parsed:{sheets:[]}};
const args=extra=>({custKey:533,scopeKey:'533|2026|41',isCurrent:()=>true,getOriginal:()=>null,fetchTemplate:async()=>result,...extra});
test('default template only actual Jugwang and valid scope, without automatic draft/link generation',async()=>{
 assert.equal(await load(args()),result);
 for(const extra of [{custKey:5},{scopeKey:'5|2026|41'},{scopeKey:'533|2026|00'},{scopeKey:'533|2026|54'}]) {
  assert.equal(await load(args({...extra,fetchTemplate:()=>{throw Error('must not fetch');}})),null);
 }
 const body=source.slice(source.indexOf('async function loadSavedWorkbook'),source.indexOf('async function uploadWorkbook'));
 assert.ok(!body.includes('setPlans('));assert.ok(!body.includes('apiPost('));assert.ok(!body.includes('workbookLinks.current.push'));
 assert.match(body,/workbookLinks.current.filter/);
});
test('same customer manual original survives scope changes and delayed default response',async()=>{
 assert.equal(await load(args({getOriginal:()=>({scope:'533|2026|40',file:{},savedTemplate:false}),fetchTemplate:()=>{throw Error('must not fetch');}})),null);
 let original=null,resolve;
 const pending=load(args({getOriginal:()=>original,fetchTemplate:()=>new Promise(done=>resolve=done)}));
 original={scope:'533|2026|41',savedTemplate:false};resolve(result);
 assert.equal(await pending,null);
});
test('upload request or scope cancellation drops stale response; invalid response blocks',async()=>{
 let current=true,resolve;
 const pending=load(args({isCurrent:()=>current,fetchTemplate:()=>new Promise(done=>resolve=done)}));
 current=false;resolve(result);assert.equal(await pending,null);
 for(const invalid of [{...result,custKey:5},{...result,sha256:'bad'},{...result,parsed:null}])
  await assert.rejects(load(args({fetchTemplate:async()=>invalid})));
 assert.match(source,/manualUpload.current = \{ custKey: Number\(customer\?\.CustKey\), request \}/);
 assert.match(source,/웹 작업 엑셀 다운로드/);
 assert.match(source,/저장 양식 사용/);
});

test('older manual upload completion cannot clear newer upload owner or busy state',()=>{
 const body=source.slice(source.indexOf('async function uploadWorkbook'),source.indexOf('async function downloadOriginalWorkbook'));
 const start=body.indexOf('if (manualUpload.current?.request === request)');
 const cleanup=body.slice(start,body.indexOf('\n    }',start));
 const execute=new Function('manualUpload','request','uploadScope','currentScope','setBusy','setTemplateReload',cleanup);
 const marker={current:{custKey:533,request:2}}; let calls=[];
 execute(marker,1,'533|2026|40',{current:'533|2026|41'},value=>calls.push(value),()=>calls.push('reload'));
 assert.deepEqual(marker.current,{custKey:533,request:2}); assert.deepEqual(calls,[]);
 execute(marker,2,'533|2026|40',{current:'533|2026|41'},value=>calls.push(value),()=>calls.push('reload'));
 assert.equal(marker.current,null); assert.deepEqual(calls,[false,'reload']);
});
