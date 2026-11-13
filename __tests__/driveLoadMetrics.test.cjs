const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLoadMetrics,sanitizedSummary}=require('../scripts/lib/drive-load-metrics.cjs');
test('300000 responses use fixed histograms and never inspect or retain response bodies',async()=>{
 const metrics=createLoadMetrics();let bodyReads=0;
 for(let i=0;i<300000;i++)await metrics.record(i%2?'login':'home',{ms:(i%100)+.2,status:200,overlap:true,get data(){bodyReads++;throw Error('Full home/JWT body accessed');}});
 const result=metrics.result();assert.equal(result.login.count,150000);assert.equal(result.home.count,150000);assert.equal(result.loginDuringUpload.count,150000);assert.equal(result.homeDuringUpload.count,150000);assert.equal(bodyReads,0);
 assert.equal(result.login.p95Ms,96);assert.equal(metrics.memory().histogramBytes,5*60002*4);assert.equal(metrics.memory().retainedRequestSamples,0);assert.equal(metrics.memory().retainedResponseBodies,0);await metrics.close();
});
test('optional timing stream and public aggregate discard tokens, bodies, unknown keys and exception strings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-load-metrics-')),file=path.join(dir,'samples.jsonl'),secret='DO_NOT_RETAIN_SYNTHETIC_JWT';
 try{
  const metrics=createLoadMetrics({sampleFile:file});
  await metrics.record('upload',{ms:12.3,status:503,data:{token:secret,home:new Array(250).fill(secret)},authorization:secret,overlap:true,timeout:false,error:false});await metrics.close();
  const text=fs.readFileSync(file,'utf8'),event=JSON.parse(text);assert(!text.includes(secret));assert.deepEqual(Object.keys(event).sort(),['ended','error','ms','overlap','route','started','status','timeout'].sort());
  const aggregate=sanitizedSummary({runId:'abc123',mode:'actual-next-production-webpack-target-api-snapshot',passed:true,errors:[secret],token:secret,telemetryPath:secret,stages:[{...metrics.result(),token:secret,errors:[secret],integrity:{missing:0},clientMemory:metrics.memory()}]});
  assert(!JSON.stringify(aggregate).includes(secret));assert.equal(aggregate.errorCount,1);assert.equal(aggregate.stages[0].upload.statuses[503],1);assert.equal(aggregate.stages[0].upload.p95Ms,13);
  assert.deepEqual(sanitizedSummary(aggregate),aggregate,'report re-sanitization must preserve aggregate failures and fixture counts');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('fresh maximum XLSX is exactly25MiB, readable, and declares its ZIP padding part content type',()=>{
 const {makeWorkbook,makePdf}=require('../scripts/lib/drive-load-fixtures.cjs'),XLSX=require('xlsx');
 const bytes=makeWorkbook('synthetic validation',25*1024*1024,'27-1');assert.equal(bytes.length,25*1024*1024);
 const names=XLSX.read(bytes,{type:'buffer',bookSheets:true}).SheetNames;assert.equal(names.length,12);assert.equal(names[0],'27-1');assert(!names.includes('01-1'));
 const zip=XLSX.CFB.read(bytes,{type:'buffer'}),types=zip.FileIndex[zip.FullPaths.findIndex(p=>p.endsWith('/[Content_Types].xml'))];assert.match(types.content.toString('utf8'),/Extension="bin" ContentType="application\/octet-stream"/);
 const pdf=makePdf('fixture').toString('ascii');assert(pdf.startsWith('%PDF-1.4'));assert.match(pdf,/xref\n0 6\n/);assert(pdf.endsWith('%%EOF\n'));
});
