import {getPool,sql} from './db.js';
import {buildProfitReportCategorySql} from './profitReportCountryResolver.js';
import {loadProfitCategoryOverrides,buildProfitOverrideCaseSqlFromMap} from './profitReportCategoryOverrides.js';
import {allowedProfitClassificationTargets} from './profitReportClassificationInput.js';
import {stockablePurchaseItemSql,reportPeriodFreightArrivalEvidence} from './profitReport.js';
import {prepareStemCostPeriods,calculateStemProductCosts,buildStemReportComparison} from './profitStemCost.mjs';
import {loadReportData,loadWeeklyReportPayload} from '../pages/api/sales/profit-report.js';
import {profitDisplayCalculation} from './profitReportStoredCalculation.js';

/** One bounded read-only raw dataset; no Product packing factor is selected or used. */
export async function readStemCostSources(scope,signal) {
  signal?.throwIfAborted();
  const pool=await getPool();
  const category=buildProfitOverrideCaseSqlFromMap(buildProfitReportCategorySql('p'),'p',allowedProfitClassificationTargets(scope.major),loadProfitCategoryOverrides(true));
  const range=a=>`${a}.OrderYear=@year AND TRY_CONVERT(int,LEFT(${a}.OrderWeek,2)) BETWEEN 1 AND @major`;
  const read=async statement=>{
    signal?.throwIfAborted();const request=pool.request();request.timeout=45000;
    request.input('year',sql.NVarChar,scope.year);request.input('major',sql.Int,Number(scope.major));
    const cancel=()=>request.cancel();signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,45000);
    try{const result=await request.query(statement);signal?.throwIfAborted();if(!Array.isArray(result.recordset))throw Error('STEM_SOURCE_INCOMPLETE');return result.recordset;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  };
  const products=await read(`SELECT p.ProdKey,p.ProdName,p.DisplayName,p.OutUnit,p.EstUnit,${category} AS Category FROM Product p WHERE ${stockablePurchaseItemSql('p')}`);
  const allHeaders=await read(`SELECT sm.StockKey,sm.OrderYear,sm.OrderWeek,(SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) ProductRows FROM StockMaster sm WHERE ${range('sm')}`);
  const headers=[...allHeaders].filter(h=>h.ProductRows>0).sort((a,b)=>Number(String(b.OrderWeek).split('-')[1])-Number(String(a.OrderWeek).split('-')[1])||b.ProductRows-a.ProductRows||b.StockKey-a.StockKey)
    .filter((h,i,rows)=>rows.findIndex(other=>Number(String(other.OrderWeek).split('-')[0])===Number(String(h.OrderWeek).split('-')[0]))===i);
  const safeKeys=rows=>rows.map(r=>{const n=Number(r);if(!Number.isSafeInteger(n)||n<=0)throw Error('STEM_INVALID_SOURCE_KEY');return n;});
  const stockKeys=safeKeys(headers.map(h=>h.StockKey));
  const stocks=stockKeys.length?await read(`SELECT ps.StockKey,ps.ProdKey,ps.Stock FROM ProductStock ps WHERE ps.StockKey IN (${stockKeys.join(',')})`):[];
  const receipts=await read(`SELECT wm.OrderYear,wm.OrderWeek,wd.WdetailKey,wd.ProdKey,wd.OutQuantity,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.TPrice FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey WHERE ${range('wm')} AND ISNULL(wm.isDeleted,0)=0`);
  // Resolve year/week first, then query the detail index in bounded PK batches.
  // The equivalent full-year join takes >45s on production despite a small result.
  const masters=await read(`SELECT sm.ShipmentKey,sm.OrderYear,sm.OrderWeek FROM ShipmentMaster sm WHERE ${range('sm')} AND ISNULL(sm.isDeleted,0)=0`);
  const byKey=new Map(masters.map(m=>[Number(m.ShipmentKey),m])),keys=safeKeys([...byKey.keys()]),shipments=[];
  for(let offset=0;offset<keys.length;offset+=300){
    const rows=await read(`SELECT sd.ShipmentKey,sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.BoxQuantity,sd.BunchQuantity,sd.SteamQuantity FROM ShipmentDetail sd WHERE sd.ShipmentKey IN (${keys.slice(offset,offset+300).join(',')}) AND sd.isFix=1 AND (ISNULL(sd.OutQuantity,0)<>0 OR ISNULL(sd.SteamQuantity,0)<>0)`);
    shipments.push(...rows.map(row=>({...row,OrderYear:byKey.get(Number(row.ShipmentKey)).OrderYear,OrderWeek:byKey.get(Number(row.ShipmentKey)).OrderWeek})));
  }
  const adjustments=await read(`SELECT sh.StockHistoryKey,sh.OrderYear,sh.OrderWeek,sh.ProdKey,sh.AfterValue-sh.BeforeValue Quantity FROM StockHistory sh WHERE ${range('sh')} AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`);
  if([products,headers,stocks,receipts,shipments,adjustments].reduce((n,r)=>n+r.length,0)>600000)throw Error('STEM_SOURCE_LIMIT');
  return {year:scope.year,major:scope.major,products,headers,stocks,receipts,shipments,adjustments};
}

// Read memo only: no SQL snapshot or filesystem cache creation. Errors are not cached.
const evidenceMemo=new Map();
async function arrival(year,week) {
  const key=`${year}:${week}`,prior=evidenceMemo.get(key);
  if(prior&&Date.now()-prior.at<30000)return prior.promise;
  if(evidenceMemo.size>128)evidenceMemo.delete(evidenceMemo.keys().next().value);
  const promise=reportPeriodFreightArrivalEvidence(year,week,{strictReceiptLines:true}).catch(error=>{evidenceMemo.delete(key);throw error;});
  evidenceMemo.set(key,{at:Date.now(),promise});return promise;
}
export async function loadStemCostReport(scope,signal,onProgress=()=>{}) {
  const dataset=await readStemCostSources(scope,signal);
  const prepared=prepareStemCostPeriods(dataset),evidence={};
  for(let n=0;n<prepared.neededWeeks.length;n+=2) {
    signal?.throwIfAborted();
    onProgress(`입고 도착원가 확인 ${n}/${prepared.neededWeeks.length}개 세부차수`);
    await Promise.all(prepared.neededWeeks.slice(n,n+2).map(async week=>{try{evidence[week]=await arrival(scope.year,week);}catch{evidence[week]={};}}));
  }
  signal?.throwIfAborted();
  const products=calculateStemProductCosts(prepared,evidence,scope);
  onProgress('현재 본표와 기존 저장본 계산식 대조 중');
  const [live,saved]=await Promise.all([loadReportData(scope.major,scope.year),loadWeeklyReportPayload(scope.major,scope.year).catch(error=>{if(error.statusCode===409)return null;throw error;})]);
  signal?.throwIfAborted();
  const legacy=saved?profitDisplayCalculation(saved):null;
  return {...buildStemReportComparison({scope,products,live,legacy}),source:{quantity:'WarehouseDetail/ShipmentDetail.SteamQuantity',inventory:'ProductStock + historical same-product stems/OutQuantity ratio',cost:'same receipt WdetailKey full landed amount, purchase-period FX',atomicSnapshot:false,legacyAvailable:!!legacy}};
}
