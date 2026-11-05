// SELECT-only audit. Prints aggregate financial invariants, never raw payloads.
import sql from 'mssql';
import assert from 'node:assert/strict';
import { profitDisplayCalculation } from '../lib/profitReportStoredCalculation.js';
const year=process.env.PROBE_YEAR || '2026';
if(!/^20\d{2}$/.test(year)) throw Error('Invalid year');
const pool=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionTimeout:10000,options:{encrypt:false,trustServerCertificate:true}});
try {
 const r=await pool.request().input('year',sql.NVarChar,year).query(`
 SELECT s.MajorWeek,s.PayloadJson FROM WebProfitReportSnapshot s
 JOIN (SELECT MajorWeek,MAX(VersionNo) v FROM WebProfitReportSnapshot WHERE OrderYear=@year GROUP BY MajorWeek) latest
 ON latest.MajorWeek=s.MajorWeek AND latest.v=s.VersionNo WHERE s.OrderYear=@year;
 SELECT h.MajorWeek,d.Category,d.ColKey,d.Value FROM WebProfitReportConfirm h
 JOIN WebProfitReportConfirmDetail d ON d.ConfirmKey=h.ConfirmKey
 WHERE h.OrderYear=@year AND h.IsActive=1 AND d.ColType='CALC';`);
 const results=[];
 const check=(major,payload,kind)=>{
  const before=JSON.stringify(payload),view=profitDisplayCalculation(payload);let changed=0,checked=0;
  for(const c of [...view.rows.map(row=>row.calc),view.totals]){
   if(!c)continue;const expected=c.C==null||c.J==null||Number(c.C)===0?null:Number(c.J)/Number(c.C);
   assert.equal(c.K,expected,`${major} ${kind} K`);checked++;
  }
  for(let i=0;i<view.rows.length;i++){
   const original=payload.rows[i].calc,current=view.rows[i].calc;
   for(const key of Object.keys(original||{}))if(key!=='K')assert.deepEqual(current[key],original[key],`${major} ${kind} preserved ${key}`);
   if(original?.K!==current?.K)changed++;
  }
  assert.equal(JSON.stringify(payload),before,'Source must remain immutable');
  const sourceTotals=payload.confirmed?payload.confirmedTotals:payload.templateDuty?payload.effectiveViewTotals:payload.totals;
  if(sourceTotals)for(const key of Object.keys(sourceTotals))if(key!=='K')assert.deepEqual(view.totals[key],sourceTotals[key],`${major} preserved total ${key}`);
  results.push({major:Number(major),kind,checked,changedRows:changed,changedTotal:sourceTotals?.K!==view.totals.K});
 };
 for(const row of r.recordsets[0]){
  const p=JSON.parse(row.PayloadJson);if(!p.rows?.every(row=>row.calc))throw Error(`Missing calc ${row.MajorWeek}`);
  check(row.MajorWeek,p,'snapshot');
 }
 const confirms=new Map();
 for(const d of r.recordsets[1]){
  const week=confirms.get(d.MajorWeek)||new Map(),calc=week.get(d.Category)||{};calc[d.ColKey]=d.Value==null?null:Number(d.Value);week.set(d.Category,calc);confirms.set(d.MajorWeek,week);
 }
 for(const [major,categories] of confirms){
  const entries=[...categories];const total=entries.find(([name])=>/TOTAL|합계|__total/i.test(name));
  check(major,{confirmed:true,rows:entries.filter(e=>e!==total).map(([category,calc])=>({category,calc})),confirmedTotals:total?.[1]||{}},'confirmed');
 }
 console.log(JSON.stringify({audit:'PASS',year,results,actualBusinessWrites:0}));
} finally {await pool.close();}
