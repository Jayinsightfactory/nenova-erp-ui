// Authenticated SELECT-only production audit. Never log payloads, notes or credentials.
import assert from 'node:assert/strict';
import { profitDisplayCalculation } from '../lib/profitReportStoredCalculation.js';
const token=process.env.NENOVAWEB_SERVICE_TOKEN;
if(!token)throw Error('Configured service credential unavailable');
const year=String(process.env.PROBE_YEAR||'2026'),end=Number(process.env.PROBE_LAST_WEEK||44);
if(!/^20\d{2}$/.test(year)||!Number.isInteger(end)||end<1||end>53)throw Error('Invalid scope');
const get=async(path)=>{
 const response=await fetch(`https://nenovaweb.com${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(180000)});
 assert.equal(response.status,200,`GET HTTP ${response.status}`);return response.json();
};
const results=[];
for(let n=1;n<=end;n++){
 const week=String(n).padStart(2,'0');
 const payload=await get(`/api/sales/profit-report?year=${year}&week=${week}`);
 assert.equal(String(payload.orderYear),year);assert.equal(Number(payload.major),n);
 const source=JSON.stringify(payload),view=profitDisplayCalculation(payload);
 for(const calc of [...view.rows.map(row=>row.calc),view.totals]){
  const expected=Number.isFinite(calc?.J)&&Number.isFinite(calc?.C)&&calc.C!==0?calc.J/calc.C:null;
  assert.equal(calc.K,expected,`K invariant ${week}`);
 }
 assert.equal(JSON.stringify(payload),source,'Payload immutable');
 const notes=await get(`/api/sales/profit-stock-adjustment-notes?year=${year}&week=${week}&detail=1`);
 assert.equal(notes.ok,true);assert.equal(notes.orderYear,year);assert.equal(Number(notes.major),n);
 assert.equal(typeof notes.text,'string');assert.ok(!/NaN|Infinity|undefined/.test(notes.text),'Invalid note numeric value');
 results.push({week,rows:view.rows.length,adjustments:notes.count,notePresent:notes.text.length>0});
 console.log(JSON.stringify({weekAudit:'PASS',year,week,actualBusinessWrites:0}));
}
console.log(JSON.stringify({profitMarginAllWeeks:'PASS',year,weeks:results.length,results,actualBusinessWrites:0}));
