import { getPool,sql } from './db';
import { currentErpReadContext, erpContextCache } from './erpReadContext.js';
import { getArrivalCostsForWeekRange } from './pivotFreightArrival';
import { latestSnapshots } from './profitReportSnapshot';
import { getActiveConfirms } from './profitReportConfirm';
import { hydrateCountrySplitColumns } from './customsForwarding';
import { getHistoricalCountryCustomsRow } from './profitReportHistoricalCustoms';
import { classifyCategory } from './profitReportClassification';
import { applyTemplateDutyView,TEMPLATE_DUTY_VERSION,restoreHistoricalDutyBlank } from './profitTemplateDuty.mjs';
import approvedPolicy from '../data/profit-template-duty-2026.json';
import officialPolicy from '../data/profit-official-duty-2026.json';
import workbookPolicy from '../data/profit-workbook-duty-2026.json';
import chinaRecoveryPolicy from '../data/profit-china-duty-recovery-2026.json';
import {applyAverageFallbackToReport,clearAverageFallbackCache} from './profitAverageData';
import {readInvoiceCosts} from './invoiceReceiptCost.js';
import {approvedReceiptDutyCosts} from './profitApprovedReceiptCosts.mjs';
import {preservesProfitMoney} from './profitReportReadPolicy.js';
import {profitCacheSourcePayload} from './profitReportFinalCache.mjs';
const policy={...approvedPolicy,official:officialPolicy,workbook:workbookPolicy,chinaRecovery:chinaRecoveryPolicy};

// Bounded process-memory cache only. Failure cooldown prevents a monthly batch
// from repeating the same failed query; retries resume after five seconds.
const cache=new Map(),TTL=60_000;
export function clearTemplateDutyCache(){cache.clear();clearAverageFallbackCache();}
async function boundedQuery(statement,params={},signal){
  if(signal.aborted)throw new Error('DUTY_SOURCE_TIMEOUT');
  const context=currentErpReadContext();
  if(context)return context.query(statement,params);
  const request=(await getPool()).request();request.timeout=45_000;
  for(const [name,{type,value}] of Object.entries(params))request.input(name,type,value);
  const cancel=()=>request.cancel();signal.addEventListener('abort',cancel,{once:true});
  try{if(signal.aborted)throw new Error('DUTY_SOURCE_TIMEOUT');return await request.query(statement);}
  finally{signal.removeEventListener('abort',cancel);}
}
export async function loadTemplateDutyContext(year){
  if(String(year)!=='2026') return null;
  const activeCache=erpContextCache('profit:template-duty',cache);
  const key=`${year}:${TEMPLATE_DUTY_VERSION}`,old=activeCache.get(key);
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
    const candidates=await read(`SELECT DISTINCT wm.WarehouseKey FROM WarehouseMaster wm
      JOIN WebInvoiceCostRevision r ON r.WarehouseKey=wm.WarehouseKey
      JOIN WebInvoiceOperation o ON o.WarehouseKey=wm.WarehouseKey AND o.Status=N'COMMITTED'
      WHERE wm.OrderYear=@year AND ISNULL(wm.isDeleted,0)=0 AND r.Basis=N'ACTUAL' AND r.Status=N'APPROVED'
      AND EXISTS (SELECT 1 FROM WarehouseDetail wd JOIN Product p ON p.ProdKey=wd.ProdKey
        WHERE wd.WarehouseKey=wm.WarehouseKey AND p.CounName=N'중국')`,{year:{type:sql.NVarChar,value:String(year)}});
    const receiptCosts=new Map();
    for(const candidate of candidates.recordset){
      const costs=await readInvoiceCosts({queryFn:read,types:sql,warehouseKey:candidate.WarehouseKey});
      for(const cost of approvedReceiptDutyCosts(costs,basis.expectedLines||[],{year,warehouseKey:candidate.WarehouseKey}))receiptCosts.set(cost.warehouseDetailKey,cost);
    }
    const lines=(basis.expectedLines||[]).filter(l=>l.active).map(expected=>{
      const l={...expected,...byLine.get(Number(expected.warehouseDetailKey))};
      const category=classifyCategory(l.country,l.flower,l.name);
      return {...l,sourceCountry:l.country,category,country:category?.startsWith('콜롬비아')?'콜롬비아':category,
        ...(receiptCosts.has(Number(l.warehouseDetailKey))?{approvedReceiptCost:receiptCosts.get(Number(l.warehouseDetailKey))}:{}),
        // Missing computation keeps an expected line: never sum only successful products.
        freightForeign:byLine.has(Number(expected.warehouseDetailKey))?l.freightForeign:null};
    });
    const customsByWeek={};
    for(let n=1;n<=53;n++){
      const major=String(n).padStart(2,'0');customsByWeek[major]={};
      for(const category of ['태국','호주','중국','에콰도르']){
        const row=(customs.recordset||[]).find(r=>Number(r.MajorWeek)===n&&r.Category===category);
        customsByWeek[major][category]=row?hydrateCountrySplitColumns(row):restoreHistoricalDutyBlank(getHistoricalCountryCustomsRow(year,major,category),year,major,category);
      }
    }
    const sourceStored=new Map([...stored].map(([key,value])=>[key,
      value?.payload?{...value,payload:profitCacheSourcePayload(value.payload)}:value]));
    return {policy,lines,customsByWeek,stored:sourceStored,confirmed,receiptCosts};
    }finally{clearTimeout(timer);controller.abort();}
  })().then(result=>{entry.pending=false;entry.expires=Date.now()+TTL;return result;},error=>{entry.pending=false;entry.expires=Date.now()+5000;throw error;});
  activeCache.set(key,entry);return entry.promise;
}

export async function applyTemplateDutyToReport(payload,year,major,options={}){
  if(preservesProfitMoney(payload))return payload;
  if(String(year)!=='2026')return payload;
  try{
    const loaded=await loadTemplateDutyContext(year);
    // Current/prior main inputs come wholly from SQL. Older acquisition-cost
    // references remain immutable donor evidence, never final current financial cells.
    const context=options.latestReports?{...loaded,stored:new Map([...loaded.stored,...options.latestReports]),confirmed:new Map(),coherentLatest:true}:loaded;
    const previousKey=String(Number(major)-1).padStart(2,'0');
    let previousPayload=options.previousPayload??context.stored.get(previousKey)?.payload;
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
    const derived=applyTemplateDutyView(source,{...context,year,major,previousPayload});
    if(context.coherentLatest&&derived.templateDuty){
      derived.templateDuty={...derived.templateDuty,coherentLatestInputs:true,label:'최신 SQL 전체 원천 · 과거 취득원가 참고 보완 · 원본 DB 미변경'};
      derived.snapshot={...derived.snapshot,templateDuty:derived.templateDuty};
    }
    return applyAverageFallbackToReport(derived,source,context,year,major);
  }catch(error){
    if(options.strict||currentErpReadContext())throw error;
    // Do not retry a derived input through the source-failure fallback: that
    // input itself is unsafe, not a missing SQL source. The API shows this
    // explicit message and refuses to produce a partial/double-counted report.
    if(error?.code==='DUTY_DERIVED_VERSION_MISMATCH')throw error;
    return applyTemplateDutyView(payload,{year,major,policy,lines:[],sourceFailure:'관세 원천 조회 실패: 확인 후 다시 조회하세요.'});
  }
}
