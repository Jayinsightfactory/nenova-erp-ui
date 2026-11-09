// Isolated real HTTP + browser + local OCR. No ERP endpoint is forwarded.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {prepareColombiaFreeRecovery} from '../lib/importColombiaFreeRecovery.js';
import {packingPdfCacheKey} from '../lib/importTeamPdfCache.js';
import {buildPrompt} from '../lib/importPackingPrompt.js';
import {PACKING_CHUNK_VERSION} from '../lib/importPackingPdfChunks.js';
import {startPackingPdfJob,markPackingPdfAttempt,updatePackingPdfChunk,finishPackingPdfJob} from '../lib/importTeamPdfJobs.js';
const require=createRequire(import.meta.url),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const root=process.cwd(),uid='free-ocr-test-'+randomUUID(),secret=randomUUID(),machine=randomUUID();
const source=process.env.FREE_OCR_SOURCE;
if(!source||!process.env.FREE_OCR_EVIDENCE||!process.env.FREE_OCR_PYTHON)throw Error('Explicit local source/evidence/python paths required');
const pdfBase64=(await fs.readFile(source)).toString('base64');
const recovery=prepareColombiaFreeRecovery(JSON.parse(await fs.readFile(process.env.FREE_OCR_EVIDENCE,'utf8')));
const key=packingPdfCacheKey({country:'CO',pdfBase64,prompt:buildPrompt('CO',{awbDocument:false})+'\n['+PACKING_CHUNK_VERSION+']'});
const admission=await startPackingPdfJob(uid,key);await markPackingPdfAttempt(uid,admission.job.jobId,admission.token);
for(const chunk of recovery.plan.slice(0,3)){
 await updatePackingPdfChunk(uid,admission.job.jobId,admission.token,{index:chunk.index,pages:chunk.pages});
 await updatePackingPdfChunk(uid,admission.job.jobId,admission.token,chunk);
}
await finishPackingPdfJob(uid,admission.job.jobId,admission.token,{error:{message:'isolated fourth segment fixture'}});
const {createHash}=await import('node:crypto');
const saved=path.join(root,'data/runtime/import-team/pdf-jobs',createHash('sha256').update(uid).digest('hex'),admission.job.jobId+'.json');
const before=JSON.parse(await fs.readFile(saved,'utf8')),prefix=JSON.stringify(before.chunks.slice(0,3));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base='http://127.0.0.1:'+port,env={...process.env,DB_SERVER:'',JWT_SECRET:secret,ORBIT_DRIVE_INGEST_TOKEN:machine};
await fs.mkdir('.verify',{recursive:true});const log=await fs.open('.verify/free-ocr-http-server.log','w');
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
let browser,worker;let blocked=0;
try{
 for(let i=0;i<90;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(i===89)throw Error('Local server unavailable');await new Promise(r=>setTimeout(r,1000));}
 browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080});
 await page.setCookie({name:'nenovaToken',value:jwt.sign({userId:uid,userName:'격리 OCR 검증',authority:4,accountActive:true},secret,{expiresIn:'1h'}),url:base});
 await page.setRequestInterception(true);
 page.on('request',request=>{const u=new URL(request.url());if(!u.pathname.startsWith('/api/'))return request.continue();
  if(u.origin===base&&['/api/import/tools/free-ocr','/api/import/tools/parse-pdf'].includes(u.pathname))return request.continue();
  blocked++;return request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,products:[],value:null,revision:0,items:[],rows:[],history:[],data:[]})});});
 await page.goto(base+'/import/tools?popup=1',{waitUntil:'domcontentloaded',timeout:120000});
 const queued=new Promise(resolve=>page.on('response',response=>{if(response.url()===base+'/api/import/tools/free-ocr'&&response.request().method()==='POST')resolve();}));
 const work=page.evaluate(async({pdfBase64,id})=>{
  const j=async r=>{const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};
  let job=(await j(await fetch('/api/import/tools/free-ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:'CO',pdfBase64})}))).job;
  for(let i=0;i<120&&['QUEUED','RUNNING'].includes(job.status);i++){await new Promise(r=>setTimeout(r,1000));job=(await j(await fetch('/api/import/tools/free-ocr?jobId='+job.jobId))).job;}
  if(job.status!=='SUCCEEDED')throw Error('OCR worker did not succeed');
  return j(await fetch('/api/import/tools/parse-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:'CO',pdfBase64,freeOcrJobId:job.jobId,retryJobId:id})}));
 },{pdfBase64,id:admission.job.jobId});
 await queued;worker=spawn(process.env.FREE_OCR_PYTHON,['scripts/rapidocr-bridge-worker.py','--once'],{env:{...env,NENOVAWEB_BASE:base},stdio:'ignore',windowsHide:true});
 const result=await work;assert.equal(result.status,'SUCCEEDED');assert.equal(result.revalidation.preserved,3);
 const after=JSON.parse(await fs.readFile(saved,'utf8'));assert.equal(JSON.stringify(after.chunks.slice(0,3)),prefix);
 const document=JSON.parse(result.result.content[0].text);assert.equal(document.invoices.length,31);
 console.log(JSON.stringify({passed:true,route:'real browser HTTP → local worker → recovery',invoices:31,preserved:3,paidCalls:0,erpWrites:0,blockedOtherApiRequests:blocked}));
}finally{await browser?.close();worker?.kill();server.kill();await log.close();}
