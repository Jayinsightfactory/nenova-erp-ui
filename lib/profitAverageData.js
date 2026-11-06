// Read-only annual source adapter. No persistence, snapshot refresh or ERP writes.
import {getPool,sql} from './db';
import {currentErpReadContext,erpContextCache} from './erpReadContext.js';
import {getKcsTaxableRate} from './kcsTaxableRate';
import {approvedCustomsTiming} from './profitReportCustomsRateTiming.mjs';
import {applyTemplateDutyView} from './profitTemplateDuty.mjs';
import {buildAverageConversionSources,buildCategoryAverageDonors,buildReceiptCostDonors,buildKnownPurchaseSources} from './profitAverageSources.mjs';
import {applyAverageFallbackView} from './profitAverageView.mjs';
import {createHash} from 'node:crypto';
import {buildNativeUnitCostSources} from './profitNativeUnitCosts.mjs';
let sharedCache=new WeakMap();
const sharedUnchangedSources=new Map();
export function clearAverageFallbackCache(){sharedCache=new WeakMap();sharedUnchangedSources.clear();}
async function read(statement,year){
 const scoped=currentErpReadContext();
 if(scoped){const result=await scoped.query(statement,{year:{type:sql.NVarChar,value:String(year)},prior:{type:sql.NVarChar,value:String(Number(year)-1)}});if(result.recordset.length>150000)throw new Error('AVERAGE_SOURCE_LIMIT');return result.recordset;}
 const request=(await getPool()).request();request.timeout=45000;
 request.input('year',sql.NVarChar,String(year));request.input('prior',sql.NVarChar,String(Number(year)-1));
 const result=await request.query(statement);if(result.recordset.length>150000)throw new Error('AVERAGE_SOURCE_LIMIT');return result.recordset;
}
export async function loadAverageSources(context,year){
 const cache=erpContextCache('profit:average',sharedCache,()=>new WeakMap());
 const unchangedSources=erpContextCache('profit:average-unchanged',sharedUnchangedSources);
 if(cache.has(context))return cache.get(context);
 const pending=(async()=>{
  const [products,receipts,stocks]=await Promise.all([
   read('SELECT ProdKey,ProdName,DisplayName,CounName,FlowerName,OutUnit,EstUnit,SteamOf1Bunch,SteamOf1Box,BunchOf1Box FROM Product',year),
   read(`SELECT wm.OrderYear,wm.OrderWeek,wm.WarehouseKey,wd.WdetailKey,wd.ProdKey,wd.OutQuantity,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.TPrice FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey WHERE wm.OrderYear IN (@year,@prior) AND ISNULL(wm.isDeleted,0)=0`,year),
   read(`SELECT OrderYear,OrderWeek,StockKey,ProdKey,Stock,SnapshotRowCount FROM (SELECT sm.OrderYear,sm.OrderWeek,sm.StockKey,ps.ProdKey,ps.Stock,COUNT(*) OVER(PARTITION BY sm.StockKey) SnapshotRowCount,ROW_NUMBER() OVER(PARTITION BY sm.StockKey ORDER BY ps.ProdKey) SnapshotRowNo FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey WHERE sm.OrderYear=@year OR (sm.OrderYear=@prior AND sm.OrderWeek>='52-01')) s WHERE Stock<>0 OR SnapshotRowNo=1`,year),
  ]);
  products.sort((a,b)=>Number(a.ProdKey)-Number(b.ProdKey));
  receipts.sort((a,b)=>String(a.OrderYear).localeCompare(String(b.OrderYear))||Number(a.WdetailKey)-Number(b.WdetailKey));
  stocks.sort((a,b)=>Number(a.StockKey)-Number(b.StockKey)||Number(a.ProdKey)-Number(b.ProdKey));
  const fingerprint=createHash('sha256').update(JSON.stringify({year,products,receipts,stocks,stored:[...context.stored],policy:context.policy,customs:context.customsByWeek,lines:context.lines})).digest('hex');
  const unchanged=unchangedSources.get(String(year));if(unchanged?.fingerprint===fingerprint)return unchanged.value;
  const reports=[],fxByCategory={};
  for(const [major,stored]of [...context.stored.entries()].sort((a,b)=>Number(a[0])-Number(b[0]))){
   if(!stored?.payload?.rows)continue;
   const previous=context.stored.get(String(Number(major)-1).padStart(2,'0'))?.payload;
   reports.push({major,...applyTemplateDutyView(stored.payload,{...context,year,major,previousPayload:previous})});
  }
  const recovery=reports.find(r=>Number(r.major)===18);
  await Promise.all((recovery?.rows||[]).filter(r=>r.calc?.R==null&&r.manual?.R==null).map(async row=>{
   const timing=approvedCustomsTiming({orderYear:year,major:18,category:row.category,currency:row.currency,missingCostRecovery:true});
   if(!timing)return;const fx=await getKcsTaxableRate({currency:timing.currency,declarationDate:timing.date});
   if(fx.available&&fx.rate>0)fxByCategory[row.category]={...fx,timing};
  }));
  // Donors precede all average overlays. A fallback result can never feed this pool.
  const conversions=buildAverageConversionSources(products,receipts);
  const category=buildCategoryAverageDonors(reports,products,receipts,conversions);
  const receipt=buildReceiptCostDonors(reports,products,receipts,conversions,year);
  const donors=[...new Map([...receipt.donors,...category.donors].map(d=>[d.id,d])).values()];
  const purchases=buildKnownPurchaseSources(reports,products,receipts,conversions);
  const nativeUnitCosts=buildNativeUnitCostSources(reports,products,receipts,context.lines);
  const options={year,products,receipts,stocks,conversions,donors,purchases,nativeUnitCosts,receiptCosts:context.receiptCosts,allowReferencePeriod:true,allowCurrentSnapshotBasis:true};
  const derived=new Map();
  for(const report of reports){const major=report.major;
   derived.set(String(major).padStart(2,'0'),applyAverageFallbackView(report,{...options,major,rawRows:context.stored.get(String(major).padStart(2,'0'))?.payload?.rows||[],previousRows:derived.get(String(Number(major)-1).padStart(2,'0'))?.rows||[],fxByCategory:Number(major)===18?fxByCategory:{}}));
  }
  const value={...options,derived,fxByCategory};unchangedSources.set(String(year),{fingerprint,value});return value;
 })();cache.set(context,pending);return pending;
}
export async function applyAverageFallbackToReport(payload,raw,context,year,major){
 try{
  const sources=await loadAverageSources(context,year);
  return applyAverageFallbackView(payload,{...sources,major,rawRows:raw.rows,previousRows:sources.derived.get(String(Number(major)-1).padStart(2,'0'))?.rows||[],fxByCategory:Number(major)===18?sources.fxByCategory:{}});
 }catch(error){
  if(currentErpReadContext())throw error;
  return {...payload,averageFallback:{available:false,dbWrites:0,reason:'평균 원가 근거 조회가 완료되지 않았습니다. 다시 조회해 주세요.',code:'AVERAGE_SOURCE_UNAVAILABLE'}};
 }
}
