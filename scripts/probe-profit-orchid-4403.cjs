// Explicit diagnostic only. SELECT/local or authenticated GET/remote; never refresh/save.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const scope={orderYear:'2026',major:'44'};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.01,`${a} != ${b}`);
const financialRows=rows=>rows.map(r=>r.slice(0,9).map(v=>v==null||v===''?null:v));
async function verify(payload,evidence){
 const {buildChinaTransportBreakdown,TRANSPORT_AMOUNT_KEYS}=await import('../lib/profitChinaTransport.mjs');
 const marker=payload.orchid4403View;
 assert.equal(marker?.changed,true,'Approved projection must be applied exactly once');
 const china=payload.rows.find(r=>r.category==='중국').calc;
 assert.equal(china.Q,112970);close(china.P,china.Q*china.R);
 close(china.I,china.E+china.G+china.H-china.F);close(china.J,china.C-china.I+(china.AJ||0));
 const item=evidence.incoming.filter(r=>Number(r.warehouseKey)===7870&&Number(r.prodKey)===3529);
 assert.equal(item.length,1);assert.equal(item[0].quantity,600);assert.equal(item[0].amount,13800);
 const breakdown=buildChinaTransportBreakdown(china,evidence,scope);
 assert.equal(breakdown.rows.length,2);assert.deepEqual(breakdown.unavailableColumns,[]);
 for(const key of TRANSPORT_AMOUNT_KEYS)if(china[key]!=null){
  close(breakdown.rows.reduce((s,r)=>s+r.calc[key],0),china[key]);
  assert.equal(breakdown.rows.reduce((s,r)=>s+r.display[key],0),Math.round(china[key]));
 }
 return {china:{Q:china.Q,P:china.P,F:china.F,J:china.J,K:china.K},transport:breakdown.rows.map(r=>({id:r.id,Q:r.calc.Q,J:r.calc.J,K:r.calc.K})),childSumMatches:true};
}
async function local(){
 if(process.argv.includes('--api'))require('node:module').register('data:text/javascript,'+encodeURIComponent(`import fs from 'node:fs';import{fileURLToPath}from'node:url';export async function load(url,ctx,next){if(url.endsWith('.json'))return{format:'json',source:fs.readFileSync(fileURLToPath(url)),shortCircuit:true};return next(url,ctx);}`));
 const sql=require('mssql');
 const {withErpReadContext}=await import('../lib/erpReadContext.js');
 const {orchid4403ReportView}=await import('../lib/profitOrchid4403Data.js');
 const {loadChinaTransportEvidence}=await import('../lib/profitChinaTransportData.js');
 const p=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true}});
 let reads=0;
 const read=async(statement,params={})=>{
  const cleaned=String(statement).replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(cleaned),'SELECT-only guard');
  const req=p.request();for(const[name,v]of Object.entries(params))req.input(name,v.type,v.value);
  reads++;return req.query(statement);
 };
 const sourceSql=`SELECT TOP(1) VersionNo,PayloadJson FROM WebProfitReportSnapshot WHERE OrderYear='2026' AND MajorWeek='44' ORDER BY VersionNo DESC;
 SELECT UPrice,TPrice,OutQuantity,SteamQuantity FROM WarehouseDetail WHERE WarehouseKey=7870 AND WdetailKey=47389 AND ProdKey=3529`;
 const hash=r=>crypto.createHash('sha256').update(JSON.stringify(r.recordsets)).digest('hex');
 try{
  const before=await read(sourceSql),payload=JSON.parse(before.recordsets[0][0].PayloadJson),original=JSON.stringify(payload);
  const result=await withErpReadContext({queryFn:read,allowExternalEvidenceReads:true},async()=>{
   const view=process.argv.includes('--api')?await(await import('../pages/api/sales/profit-report.js')).loadWeeklyReportPayload('44','2026'):await orchid4403ReportView(payload,'44','2026');
   const evidence=await loadChinaTransportEvidence(scope);
   const result=await verify(view,evidence);
   const {profitDisplayCalculation}=await import('../lib/profitReportStoredCalculation.js');
   const {buildProfitReportXlsx}=await import('../lib/profitReportExcel.js');
   const {compareProfitSmokeOutput}=await import('./profit-smoke-comparison.mjs');
   const display=profitDisplayCalculation(view);
   const workbook=buildProfitReportXlsx({major:'44',rows:display.rows,confirmedTotals:display.totals,visibleCols:['C','E','F','G','H','I','J','K'],displayCategory:true,displaySheetFirst:true,returnWorkbook:true});
   const rows=require('xlsx').utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});
   assert.deepEqual(compareProfitSmokeOutput(view,financialRows(rows)).differences,[]);
   return {...result,outputMatches:true,sheets:workbook.SheetNames.length};
  });
  assert.equal(JSON.stringify(payload),original);
  const after=await read(sourceSql);assert.equal(hash(after),hash(before));
  console.log(JSON.stringify({status:'PASS',mode:'SELECT-only',...result,reads,originalUnchanged:true,snapshotVersion:before.recordsets[0][0].VersionNo,sourceFingerprint:hash(before)}));
 }finally{await p.close();}
}
async function remote(){
 const token=process.env.NENOVAWEB_SERVICE_TOKEN;assert.ok(token,'Service credential unavailable');
 const get=async path=>{const r=await fetch('https://nenovaweb.com'+path,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(180000)});assert.ok(r.ok,`HTTP ${r.status}`);return r.json();};
 const payload=await get('/api/sales/profit-report?year=2026&week=44');assert.equal(payload.success,true);
 const base='/api/sales/profit-china-transport?year=2026&week=44';let evidence=await get(base);
 const deadline=Date.now()+180000;
 while(evidence.status==='running'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,2000));evidence=await get(base+'&jobId='+encodeURIComponent(evidence.jobId));}
 assert.equal(evidence.ok,true);assert.ok(evidence.incoming,'Evidence completed');
 const result=await verify(payload,evidence);
 const output=await get('/api/sales/profit-report-output?year=2026&week=44&cols=C,E,F,G,H,I,J,K&category=1');assert.equal(output.success,true);
 const xlsx=require('xlsx'),wb=output.workbook;assert.equal(wb.SheetNames[0],'화면표시(선택컬럼)');
 const rows=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
 const {compareProfitSmokeOutput}=await import('./profit-smoke-comparison.mjs');
 const comparison=compareProfitSmokeOutput(payload,financialRows(rows));assert.deepEqual(comparison.differences,[]);
 console.log(JSON.stringify({status:'PASS',mode:'GET-only',...result,outputMatches:true,sheets:wb.SheetNames.length}));
}
if(require.main===module)(process.argv.includes('--remote')?remote():local()).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify};
