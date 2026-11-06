// Operational SELECT-only evidence. Never print credentials, raw JSON or personal data.
const sql=require('mssql'),crypto=require('node:crypto');
require('@next/env').loadEnvConfig(process.env.PROFIT_ENV_DIR||'C:/Users/USER/nenova-erp-ui',false,{info(){},error(){}});
(async()=>{
 const pool=await sql.connect({server:process.env.DB_SERVER,port:+(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true,requestTimeout:60000}});
 try{
  if(process.argv.includes('--fence')){
   const {latestProfitInvoiceFence}=await import('../lib/profitLatestInvoiceFence.js');
   console.log(JSON.stringify({invoiceFence:await latestProfitInvoiceFence(['2025','2026']),selectOnly:true}));return;
  }
  if(process.argv.includes('--report')){
   require('node:module').register('data:text/javascript,'+encodeURIComponent(`
    import fs from 'node:fs';import {fileURLToPath} from 'node:url';
    export async function resolve(spec,ctx,next){try{return await next(spec,ctx);}catch(e){if(spec.startsWith('.'))for(const ext of ['.js','/index.js']){try{return await next(spec+ext,ctx);}catch{}}throw e;}}
    export async function load(url,ctx,next){if(url.endsWith('.json'))return {format:'json',source:fs.readFileSync(fileURLToPath(url)),shortCircuit:true};return next(url,ctx);}
   `));
   const original=sql.Request.prototype.query;let reads=0;
   sql.Request.prototype.query=function(statement,...args){const clean=String(statement).replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ').trim();if(!/^(SELECT|WITH)\b/i.test(clean)||/\b(INSERT|UPDATE|DELETE|EXEC|MERGE|ALTER|CREATE|DROP)\b/i.test(clean))throw Error('SELECT only');reads++;const number=reads,start=Date.now();return original.call(this,statement,...args).catch(error=>{console.error(JSON.stringify({failedRead:number,elapsedMs:Date.now()-start,tables:[...clean.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].map(m=>m[1]).slice(0,12),code:error.code}));throw error;});};
   sql.Request.prototype.batch=sql.Request.prototype.execute=()=>{throw Error('No batch/SP');};
   const api=await import('../pages/api/sales/profit-report.js');
   for(const major of ['39','42','43','44']){
    const start=Date.now(),data=await api.loadWeeklyReportPayload(major,'2026');
    console.log(JSON.stringify({major,mode:data.readMode,elapsedMs:Date.now()-start,reads,rows:data.rows.filter(r=>['중국','베트남'].includes(r.category)).map(r=>({category:r.category,calc:r.calc,source:r.source,average:r.averageFallback?.evidence&&Object.keys(r.averageFallback.evidence)}))}));
   }
   return;
  }
  const queries=[
   "SELECT c.name,t.name typeName,i.name indexName FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id LEFT JOIN sys.index_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id LEFT JOIN sys.indexes i ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE c.object_id=OBJECT_ID(N'dbo.WebArrivalCostHistory') AND c.name=N'ArrivalLineKey'",
   "WITH h AS (SELECT CAST(42 AS int) ArrivalLineKey), l AS (SELECT * FROM (VALUES ('EXCEL','42'),('INVOICE','42'),('INVOICE','invoice:42'),('EXCEL','missing')) v(SourceKind,ArrivalLineKey)) SELECT l.SourceKind,l.ArrivalLineKey,h.ArrivalLineKey matchedHistoryKey FROM l LEFT JOIN h ON l.SourceKind=N'EXCEL' AND h.ArrivalLineKey=TRY_CONVERT(INT,l.ArrivalLineKey)",
   "SELECT CONVERT(char(10),TRY_CONVERT(date,BaseYmd),23) dateOnly,OrderYearWeek FROM PeriodDay WHERE TRY_CONVERT(date,BaseYmd) BETWEEN '2026-10-20' AND '2026-11-13' ORDER BY BaseYmd",
   "SELECT OrderYear,MajorWeek,VersionNo,PayloadJson FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY OrderYear,MajorWeek ORDER BY VersionNo DESC) rn FROM WebProfitReportSnapshot WHERE OrderYear IN ('2025','2026') AND MajorWeek IN ('39','42','43','44')) x WHERE rn=1",
  ];
  for(const statement of queries){
   if(!/^(SELECT|WITH)\b/i.test(statement)||/\b(INSERT|UPDATE|DELETE|EXEC|MERGE|ALTER|CREATE|DROP)\b/i.test(statement))throw Error('SELECT only');
   const result=await pool.request().query(statement);
   console.log(JSON.stringify(result.recordset.map(row=>row.PayloadJson?{year:row.OrderYear,major:row.MajorWeek,version:row.VersionNo,sha256:crypto.createHash('sha256').update(row.PayloadJson).digest('hex'),rowCount:JSON.parse(row.PayloadJson).rows?.length}:row)));
  }
 }finally{await pool.close();}
})().catch(error=>{console.error('SELECT probe failed: '+String(error.code||error.name)+' / '+String(error.cause?.code||''));process.exitCode=1;}).finally(async()=>{await sql.close();process.exit(process.exitCode||0);});
