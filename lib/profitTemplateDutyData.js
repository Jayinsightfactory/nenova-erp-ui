import { getPool,sql } from './db';
import { getArrivalCostsForWeekRange } from './pivotFreightArrival';
import { latestSnapshots } from './profitReportSnapshot';
import { getActiveConfirms } from './profitReportConfirm';
import { hydrateCountrySplitColumns } from './customsForwarding';
import { getHistoricalCountryCustomsRow } from './profitReportHistoricalCustoms';
import { classifyCategory } from './profitReportClassification';
import { applyTemplateDutyView,TEMPLATE_DUTY_VERSION } from './profitTemplateDuty.mjs';
import policy from '../data/profit-template-duty-2026.json';

// Bounded process-memory cache only. Failure cooldown prevents a monthly batch
// from repeating the same failed query; retries resume after five seconds.
const cache=new Map(),TTL=60_000;
export function clearTemplateDutyCache(){cache.clear();}
async function boundedQuery(statement,params={},signal){
  if(signal.aborted)throw new Error('DUTY_SOURCE_TIMEOUT');
  const request=(await getPool()).request();request.timeout=45_000;
  for(const [name,{type,value}] of Object.entries(params))request.input(name,type,value);
  const cancel=()=>request.cancel();signal.addEventListener('abort',cancel,{once:true});
  try{if(signal.aborted)throw new Error('DUTY_SOURCE_TIMEOUT');return await request.query(statement);}
  finally{signal.removeEventListener('abort',cancel);}
}
export async function loadTemplateDutyContext(year){
  if(String(year)!=='2026') return null;
  const key=`${year}:${TEMPLATE_DUTY_VERSION}`,old=cache.get(key);
  if(old && (old.pending || old.expires>Date.now()))return old.promise;
  const entry={pending:true,expires:0};
  entry.promise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45_000);
    const read=(statement,params)=>boundedQuery(statement,params,controller.signal);
    try{
    const majors=Array.from({length:53},(_,i)=>String(i+1).padStart(2,'0'));
    const [basis,customs,stored,confirmed]=await Promise.all([
      getArrivalCostsForWeekRange({orderYear:String(year),weekStart:'01-01',weekEnd:'53-99',dutyBasisOnly:true,strictReceiptLines:true,queryRunner:read}),
      read('SELECT * FROM WebCustomsWeekly WHERE OrderYear=@year',{year:{type:sql.NVarChar,value:String(year)}}),
      latestSnapshots(String(year),majors),getActiveConfirms(String(year),majors),
    ]);
    const byLine=new Map((basis.lines||[]).map(l=>[Number(l.warehouseDetailKey),l]));
    const lines=(basis.expectedLines||[]).filter(l=>l.active).map(expected=>{
      const l={...expected,...byLine.get(Number(expected.warehouseDetailKey))};
      const category=classifyCategory(l.country,l.flower,l.name);
      return {...l,category,country:category?.startsWith('콜롬비아')?'콜롬비아':category,
        // Missing computation keeps an expected line: never sum only successful products.
        freightForeign:byLine.has(Number(expected.warehouseDetailKey))?l.freightForeign:null};
    });
    const customsByWeek={};
    for(let n=1;n<=53;n++){
      const major=String(n).padStart(2,'0');customsByWeek[major]={};
      for(const category of ['태국','호주','중국','에콰도르']){
        const row=(customs.recordset||[]).find(r=>Number(r.MajorWeek)===n&&r.Category===category);
        customsByWeek[major][category]=row?hydrateCountrySplitColumns(row):getHistoricalCountryCustomsRow(year,major,category);
      }
    }
    return {policy,lines,customsByWeek,stored,confirmed};
    }finally{clearTimeout(timer);controller.abort();}
  })().then(result=>{entry.pending=false;entry.expires=Date.now()+TTL;return result;},error=>{entry.pending=false;entry.expires=Date.now()+5000;throw error;});
  cache.set(key,entry);return entry.promise;
}

export async function applyTemplateDutyToReport(payload,year,major){
  if(String(year)!=='2026')return payload;
  try{
    const context=await loadTemplateDutyContext(year);
    const previousKey=String(Number(major)-1).padStart(2,'0');
    let previousPayload=context.stored.get(previousKey)?.payload;
    const previousConfirm=context.confirmed.get(previousKey);
    if(previousConfirm?.confirm){
      previousPayload=structuredClone(previousPayload || {rows:[]});
      previousPayload.rows=previousPayload.rows.filter(row=>{
        const calc=previousConfirm.rowsByCategory?.[row.category]?.calc;
        return calc&&['E','F','H','R','G'].every(k=>calc[k]===row.calc?.[k]);
      });
    }
    let source=payload;
    if(payload.confirmed){
      source=structuredClone(payload);
      const stored=context.stored.get(String(major).padStart(2,'0'))?.payload;
      for(const row of source.rows){
        const basis=stored?.rows?.find(r=>r.category===row.category);
        if(basis&&['E','F','H','R','G'].every(k=>row.calc?.[k]===basis.calc?.[k])){
          for(const k of ['stock','beginStock','inventoryValuation','customsComponents','actualCostEvidence'])row[k]=structuredClone(basis[k]??null);
          row.manual={...row.manual,H:basis.manual?.H??null};
        }
      }
    }
    return applyTemplateDutyView(source,{...context,year,major,previousPayload});
  }catch(error){
    return applyTemplateDutyView(payload,{year,major,policy,lines:[],sourceFailure:'관세 원천 조회 실패: 확인 후 다시 조회하세요.'});
  }
}
