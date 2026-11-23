const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createIngressBudget,admitUpload}=require('../lib/workDriveIngressBudget.cjs');
test('incident-sized burst cannot create thousands of multipart parsers',()=>{
 let time=0;const budget=createIngressBudget({now:()=>time});let accepted=0;
 for(let n=0;n<4000;n++){time=n*15;if(budget.take())accepted++;}
 assert.ok(accepted<=488);assert.ok(accepted>=480);
 time+=60000;assert.equal(Array.from({length:100},()=>budget.take()).filter(Boolean).length,8,'idle time cannot accumulate an unbounded burst');
});
test('ordinary paced background uploads retain full throughput',()=>{
 let time=0;const budget=createIngressBudget({now:()=>time});for(let n=0;n<500;n++){assert.equal(budget.take(),true);time+=1200;}
});
test('rejection is retryable and never acknowledges a saved file',()=>{
 delete globalThis[Symbol.for('nenova.drive-ingress-budget.v1')];const headers={};let status,body;
 const res={setHeader:(k,v)=>headers[k]=v,status:n=>{status=n;return res},json:v=>body=v};
 for(let n=0;n<8;n++)assert.equal(admitUpload(res),true);
 assert.equal(admitUpload(res),false);assert.equal(status,429);assert.equal(headers['Retry-After'],'5');assert.equal(body.success,false);assert.equal(body.id,undefined);
 delete globalThis[Symbol.for('nenova.drive-ingress-budget.v1')];
});
test('route checks identity and OPTIONS before rate budget, budget before expensive admission',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../pages/api/work/drive-ingest.js'),'utf8');
 assert.ok(source.indexOf('if (!t.ok)')<source.indexOf('if (!admitUpload(res))'));
 assert.ok(source.indexOf("if (req.method === 'OPTIONS')")<source.indexOf('if (!admitUpload(res))'));
 assert.ok(source.indexOf('if (!admitUpload(res))')<source.indexOf('const service=startDriveIngestService()'));
});
test('real handler rejects burst before parser/storage/remit and keeps OPTIONS available',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 let source=fs.readFileSync(require.resolve('../pages/api/work/drive-ingest.js'),'utf8');
 source=source.replace(/^import .*;\r?\n/gm,'').replace('export const config','const config').replace('export default async function handler','async function handler');
 let admitted=0,parses=0,stores=0,remits=0,releases=0;
 const budget=createIngressBudget({now:()=>0});
 const service={acquire:async()=>{admitted++;return ()=>releases++},ingest:async()=>{stores++;return {result:{ok:true,id:'fixture',duplicate:true}}}};
 const context={ingressPolicy:require('../lib/workDriveIngressBudget.cjs').ingressPolicy,process:{env:{ORBIT_DRIVE_INGEST_TOKEN:'fixture-only'}},Buffer,crypto:require('node:crypto'),fs:{promises:{unlink:async()=>{}}},FILE_MAX:100,
 startDriveIngestService:()=>service,measure:(_,fn)=>fn(),admitUpload:res=>{if(budget.take())return true;res.setHeader('Retry-After','5');res.status(429).json({success:false});return false},
 formidable:()=>({on(){},async parse(){parses++;return [{},{file:{filepath:'fixture',originalFilename:'fixture.txt'}}]}}),REMIT_FILE_RE:/remit/,importRemitFile:()=>{remits++},console};
 vm.createContext(context);vm.runInContext(source+'\nthis.handler=handler;',context);
 const call=async(method='POST',token='fixture-only')=>{let status=200,body;const res={setHeader(){},status(n){status=n;return this},json(v){body=v;return this}};await context.handler({method,headers:{authorization:'Bearer '+token}},res);return {status,body}};
 for(let i=0;i<8;i++)assert.equal((await call()).status,200);
 for(let i=0;i<4000;i++){const r=await call();assert.equal(r.status,429);assert.equal(r.body.success,false);}
 assert.equal((await call('OPTIONS')).status,200);assert.equal((await call('POST','wrong')).status,401);
 assert.deepEqual({admitted,parses,stores,remits,releases},{admitted:8,parses:8,stores:8,remits:0,releases:8});
});
