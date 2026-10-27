import { query, sql } from './db.js';
import { buildProfitReportCategorySql, CATEGORIES, profitReportCategoriesForWeek } from './profitReportCountryResolver.js';
import { buildProfitOverrideCaseSqlFromMap, loadProfitCategoryOverrides } from './profitReportCategoryOverrides.js';
import { createHash } from 'node:crypto';
import { buildMarginReconciliation } from './profitCustomerMarginReconciliation.mjs';
import { freightSalesProductSql } from './profitWorkbookRules.js';
import { readStoredProfitPayload } from './profitReportSnapshot.js';
import { getActiveConfirm } from './profitReportConfirm.js';
import { reportPeriodFreightArrivalEvidence } from './profitReport.js';
import { MODEL_VERSION, normalizeMarginUnit, marginUnitFactor, completeReceiptCoverage, hasHistoricalMarginFx, physicalMarginReceipt, reconstructProductCost, buildCustomerMarginGroups } from './profitCustomerMargin.mjs';
import { decomposeCustomerMargin, buildReportedProfitBridge } from './profitCustomerMarginDrivers.mjs';

const BASE_CATEGORY = buildProfitReportCategorySql('p');
const ALLOWED_CATEGORIES = [...CATEGORIES.filter(c => !c.manualOnly).map(c => c.key), '국내'];
function marginClassification() {
  // Capture one effective mapping for both periods. Module-load SQL can outlive an edited mapping.
  const overrides = Object.fromEntries(Object.entries(loadProfitCategoryOverrides(true))
    .filter(([key, value]) => /^\d+$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key)>0 && ALLOWED_CATEGORIES.includes(value?.category))
    .sort(([a],[b]) => Number(a)-Number(b)).map(([key,value]) => [key,{category:value.category}]));
  return { sql: buildProfitOverrideCaseSqlFromMap(BASE_CATEGORY,'p',ALLOWED_CATEGORIES,overrides),
    evidence: { source:'profit-report-category-overrides', entryCount:Object.keys(overrides).length,
      fingerprint:createHash('sha256').update(JSON.stringify(overrides)).digest('hex'), capturedAt:new Date().toISOString() } };
}
const WEIGHT = `UPPER(ISNULL(p.ProdName,N'')) LIKE N'%CHARGEABLE WEIGHT%' OR UPPER(ISNULL(p.ProdName,N'')) LIKE N'%CHARGEABLE WEIGTH%' OR UPPER(ISNULL(p.ProdName,N'')) LIKE N'%GROSS WEIGHT%' OR UPPER(ISNULL(p.ProdName,N'')) LIKE N'%GROSS WEIGTH%'`;
const NUM = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const YEAR = year => ({ yr: { type: sql.NVarChar, value: year } });
const PK = `SELECT TRY_CONVERT(INT,[value]) FROM OPENJSON(@keys)`;
const HIST = alias => `${alias}.OrderYear=@yr AND TRY_CONVERT(INT,LEFT(${alias}.OrderWeek,2)) BETWEEN 1 AND @major`;
const scopeParams = scope => ({ ...YEAR(scope.year), major: { type: sql.Int, value: Number(scope.major) },
  pfx: { type: sql.NVarChar, value: `${scope.major}-%` }, yw: { type: sql.NVarChar, value: `${scope.year}${scope.major}` } });
const scopeSql = `sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND sm.OrderYearWeek=@yw AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1`;

// The new data adapter itself has no write entry point. Guard even injectable queries in tests.
export function assertMarginReadSql(statement) {
  const clean = String(statement).replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\r\n]*/g, ' ');
  if (!/^\s*(SELECT|WITH)\b/i.test(clean) || /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|EXEC(?:UTE)?|INTO|BEGIN|COMMIT|ROLLBACK)\b/i.test(clean)) throw new Error('MARGIN_READ_ONLY_SQL_REQUIRED');
}
async function read(statement, params) { assertMarginReadSql(statement); return (await query(statement, params)).recordset || []; }

export async function previousMarginScope(scope, explicit) {
  const rows = await read(`SELECT CONVERT(NVARCHAR(12),OrderYearWeek) AS yw,
      MIN(TRY_CONVERT(DATE,BaseYmd)) AS startDate,MAX(TRY_CONVERT(DATE,BaseYmd)) AS endDate
    FROM PeriodDay WHERE LEFT(CONVERT(NVARCHAR(12),OrderYearWeek),4) IN (@year,@previousYear,@compareYear)
    GROUP BY OrderYearWeek`, { year: { type: sql.NVarChar, value: scope.year }, previousYear: { type: sql.NVarChar, value: String(Number(scope.year)-1) },
      compareYear:{type:sql.NVarChar,value:explicit?.year||scope.year} });
  const selected = rows.find(r => String(r.yw) === scope.year + scope.major);
  if (!selected || !selected.startDate || !selected.endDate) throw Object.assign(new Error('선택 차수의 업무 달력 근거가 없습니다.'), { statusCode: 409 });
  if(explicit) {
    const comparison=rows.find(r=>String(r.yw)===explicit.year+explicit.major);
    if(!comparison || !selected.startDate || !comparison.endDate || new Date(comparison.endDate)>=new Date(selected.startDate))
      throw Object.assign(new Error('비교 차수의 업무 달력 근거 또는 선후관계를 확인하세요.'),{statusCode:409});
    return explicit;
  }
  const before = rows.filter(r => /^20\d{2}(0[1-9]|[1-4]\d|5[0-3])$/.test(String(r.yw)) && new Date(r.endDate) < new Date(selected.startDate))
    .sort((a,b) => new Date(b.endDate)-new Date(a.endDate))[0];
  if (!before || new Date(selected.startDate)-new Date(before.endDate) !== 86400000) throw Object.assign(new Error('직전 차수의 연속된 업무 달력 근거가 없습니다.'), { statusCode: 409 });
  return { year: String(before.yw).slice(0,4), major: String(before.yw).slice(4) };
}

async function salesRows(scope, classification) {
  const params = scopeParams(scope);
  const [sales, estimates, excluded] = await Promise.all([
    read(`SELECT sm.CustKey,c.CustName,sd.ProdKey,p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.EstUnit,
        p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch,${classification.sql} AS Category,${BASE_CATEGORY} AS BaseCategory,
        sm.OrderYear AS SourceYear,sm.OrderWeek AS SourceWeek,sm.OrderYearWeek AS SourceYearWeek,
        sd.OutQuantity,sd.EstQuantity,sd.Amount,sd.Vat,
        CASE WHEN ${freightSalesProductSql('p')} THEN N'O' ELSE N'N' END AS Kind
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      LEFT JOIN Product p ON p.ProdKey=sd.ProdKey LEFT JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE ${scopeSql} AND ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)<>0 AND NOT (${WEIGHT})`, params),
    read(`SELECT sm.CustKey,c.CustName,e.ProdKey,p.ProdName,p.CounName,p.FlowerName,p.EstUnit,${classification.sql} AS Category,${BASE_CATEGORY} AS BaseCategory,
        sm.OrderYear AS SourceYear,sm.OrderWeek AS SourceWeek,sm.OrderYearWeek AS SourceYearWeek,
        e.Amount,CASE WHEN ci.Descr2=N'불량차감' THEN N'L' ELSE N'O' END AS Kind
      FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
      LEFT JOIN Product p ON p.ProdKey=e.ProdKey LEFT JOIN Customer c ON c.CustKey=sm.CustKey
      LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE ${scopeSql} AND NOT (${WEIGHT})`, params),
    read(`SELECT COUNT(*) AS allRows,
        SUM(CASE WHEN ISNULL(sm.OrderYearWeek,N'')<>@yw THEN 1 ELSE 0 END) AS yearWeekMismatchRows,
        SUM(CASE WHEN ISNULL(sm.isFix,0)<>1 OR ISNULL(sd.isFix,0)<>1 THEN 1 ELSE 0 END) AS unconfirmedRows,
        SUM(CASE WHEN ISNULL(sd.OutQuantity,0)=0 THEN 1 ELSE 0 END) AS zeroPhysicalRows,
        SUM(CASE WHEN ISNULL(sd.OutQuantity,0)=0 THEN ISNULL(sd.Amount,0) ELSE 0 END) AS zeroPhysicalAmount
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.isDeleted,0)=0`,params),
  ]);
  const rows=[...sales, ...estimates].map(r => {
    const factor = marginUnitFactor(r,r.OutUnit,r.EstUnit);
    return { year: scope.year, major: scope.major, custKey: r.CustKey, custName: r.CustName,
      prodKey: r.ProdKey, productName: r.ProdName, country: r.CounName || '', flower: r.FlowerName || '',
      category: r.Category || '미분류', baseCategory:r.BaseCategory || '미분류',
      sourceYear:r.SourceYear,sourceWeek:r.SourceWeek,sourceYearWeek:r.SourceYearWeek,sourceTable:'OutQuantity' in r?'ShipmentDetail':'Estimate',
      unit: normalizeMarginUnit(r.EstUnit), kind: r.Kind,
      quantity: NUM(r.EstQuantity), amount: NUM(r.Amount), vat: 'OutQuantity' in r?NUM(r.Vat):0,
      amountMissing:NUM(r.Amount)==null,vatMissing:'OutQuantity' in r&&NUM(r.Vat)==null,
      physicalQuantity: factor == null || r.OutQuantity == null ? null : Number(r.OutQuantity)*factor };
  });
  rows.scopeCoverage=excluded[0]||{};return rows;
}

// Receipt helpers use their exact purchase-period FX policy. Do not call live report loaders here.
const arrivalMemo = new Map();
async function historicalArrival(year, week) {
  const key = `${year}:${week}`, now = Date.now(), prior = arrivalMemo.get(key);
  if (prior && now-prior.at < 30000) return prior.promise;
  if (arrivalMemo.size >= 128) arrivalMemo.delete(arrivalMemo.keys().next().value);
  const promise = reportPeriodFreightArrivalEvidence(year,week,{strictReceiptLines:true}).catch(error => { arrivalMemo.delete(key); throw error; });
  arrivalMemo.set(key,{at:now,promise}); return promise;
}

function physicalReceipt(row, product) {
  return physicalMarginReceipt(row,product);
}

/** All product history is batched; a missing snapshot or missing priced line cannot become zero. */
export async function productCostBasis(scope, keys, classification = marginClassification()) {
  if (!keys.length) return { costs:{},adjustments:[],warnings:[] };
  const params={...scopeParams(scope),keys:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(keys)}};
  const [products,headers,stocks,receipts,ships,adjustments,nativeMovements] = await Promise.all([
    read(`SELECT p.ProdKey,p.ProdName,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch FROM Product p WHERE p.ProdKey IN (${PK})`,params),
    read(`SELECT sm.StockKey,sm.OrderWeek,(SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) AS ProductRows
      FROM StockMaster sm WHERE ${HIST('sm')} AND EXISTS(SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)`,params),
    read(`SELECT sm.StockKey,ps.ProdKey,ps.Stock FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      WHERE ${HIST('sm')} AND ps.ProdKey IN (${PK})`,params),
    read(`SELECT wm.OrderWeek,wd.WdetailKey,wd.ProdKey,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.TPrice
      FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      WHERE ${HIST('wm')} AND ISNULL(wm.isDeleted,0)=0 AND wd.ProdKey IN (${PK})`,params),
    read(`SELECT LEFT(sm.OrderWeek,2) AS MajorWeek,sd.ProdKey,SUM(ISNULL(sd.OutQuantity,0)) AS Quantity
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      WHERE ${HIST('sm')} AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1 AND sd.ProdKey IN (${PK})
      GROUP BY LEFT(sm.OrderWeek,2),sd.ProdKey`,params),
    read(`SELECT sh.OrderWeek,sh.ProdKey,sh.AfterValue-sh.BeforeValue AS Quantity,sh.Descr,sh.ChangeDtm,p.OutUnit,${classification.sql} AS Category
      FROM StockHistory sh LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
      WHERE ${HIST('sh')} AND sh.ProdKey IN (${PK})
        AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`,params),
    read(`SELECT x.OrderYear,x.OrderWeek,x.ProdKey,SUM(x.InQty) RawIn,SUM(x.OutQty) RawOut,SUM(x.AdjustQty) RawAdjust,ROUND(SUM(x.InQty),2) NativeIn,
        ROUND(SUM(x.OutQty),2) NativeOut,ROUND(SUM(x.AdjustQty),2) NativeAdjust
      FROM (
        SELECT v.OrderYear,v.OrderWeek,v.ProdKey,v.OutQuantity InQty,0 OutQty,0 AdjustQty
          FROM ViewWarehouse v WHERE ${HIST('v')} AND v.ProdKey IN (${PK})
        UNION ALL SELECT v.OrderYear,v.OrderWeek,v.ProdKey,0,v.OutQuantity,0
          FROM ViewShipment v WHERE ${HIST('v')} AND v.DetailFix=1 AND v.ProdKey IN (${PK})
        UNION ALL SELECT sh.OrderYear,sh.OrderWeek,sh.ProdKey,0,0,sh.AfterValue-sh.BeforeValue
          FROM StockHistory sh WHERE ${HIST('sh')} AND sh.ProdKey IN (${PK})
          AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)
      ) x GROUP BY x.OrderYear,x.OrderWeek,x.ProdKey`,params),
  ]);
  const latest = new Map();
  for (const h of headers) {
    const match=/^(\d{1,2})-(\d{1,2})$/.exec(String(h.OrderWeek)); if(!match) continue;
    const major=Number(match[1]),sub=Number(match[2]),old=latest.get(major);
    if(!old || sub>old.sub || (sub===old.sub && (h.ProductRows>old.ProductRows || h.ProductRows===old.ProductRows && h.StockKey>old.StockKey))) latest.set(major,{...h,sub});
  }
  const stockIndex=new Map(),duplicateStocks=new Set(); for(const s of stocks) { const key=`${s.StockKey}:${s.ProdKey}`;
    if(stockIndex.has(key)) duplicateStocks.add(key);stockIndex.set(key,NUM(s.Stock)); }
  const stockAt=(header,prodKey)=>{if(!header)return null;const key=`${header.StockKey}:${prodKey}`;return stockIndex.has(key)?stockIndex.get(key):0;};
  const plans={}, needed=new Set();
  for(const p of products) {
    const factor=marginUnitFactor(p,p.OutUnit,p.EstUnit), periods=[];
    let anchor=0;
    for(const [major,h] of latest) if(major<Number(scope.major) && !duplicateStocks.has(`${h.StockKey}:${p.ProdKey}`) && stockAt(h,p.ProdKey)===0) anchor=Math.max(anchor,major);
    for(let major=anchor||1;major<=Number(scope.major);major++) {
      const h=latest.get(major),rr=receipts.filter(r=>r.ProdKey===p.ProdKey && Number(String(r.OrderWeek).split('-')[0])===major);
      const aa=adjustments.filter(r=>r.ProdKey===p.ProdKey && Number(String(r.OrderWeek).split('-')[0])===major);
      const ss=ships.filter(r=>r.ProdKey===p.ProdKey && Number(r.MajorWeek)===major);
      const unitKnown=factor!=null && rr.every(r=>physicalReceipt(r,p)!=null && NUM(r.OutQuantity)!=null && Math.abs(physicalReceipt(r,p)-Number(r.OutQuantity)*factor)<0.011);
      periods.push({year:scope.year,major,product:p,rows:rr,snapshotExists:!!h,unitKnown,duplicateStock:h?duplicateStocks.has(`${h.StockKey}:${p.ProdKey}`):false,
        nativeFactor:factor,nativeSteps:nativeMovements.filter(r=>r.ProdKey===p.ProdKey && Number(String(r.OrderWeek).split('-')[0])===major),
        endQuantity:h && factor!=null && stockAt(h,p.ProdKey)!=null ? stockAt(h,p.ProdKey)*factor:null,
        receiptQuantity:rr.reduce((s,r)=>s+(physicalReceipt(r,p)||0),0),receiptAmount:rr.length?null:0,receiptComplete:!rr.length,
        shipQuantity:factor==null?null:ss.reduce((s,r)=>s+Number(r.Quantity)*factor,0),
        adjustmentQuantity:factor==null?null:aa.reduce((s,r)=>s+Number(r.Quantity)*factor,0),hasPositiveAdjustment:aa.some(r=>Number(r.Quantity)>0),sourceRefs:[]});
      if(major>anchor) for(const r of rr) if(Number(r.OutQuantity)>0) needed.add(String(r.OrderWeek));
    }
    plans[p.ProdKey]={p,periods};
  }
  // Only exact purchase periods after each product's actual zero-stock anchor.
  // Keep concurrency bounded, but never discard older evidence at a global 12-week cutoff.
  const weeks=[...needed].sort((a,b)=>Number(b.replace('-',''))-Number(a.replace('-',''))), selected=weeks, evidence={};
  const warnings=[];
  for(let i=0;i<selected.length;i+=2) await Promise.all(selected.slice(i,i+2).map(async week=>{
    try {evidence[week]=await historicalArrival(scope.year,week);} catch {evidence[week]={};warnings.push(`${scope.year}/${week} 도착원가 원천 조회 실패`);}
  }));
  const costs={};
  for(const {p,periods} of Object.values(plans)) {
    for(const period of periods) if(period.rows.length) {
      let amount=0,complete=true,estimated=false;
      period.receiptReasons=[];
      for(const week of new Set(period.rows.map(r=>String(r.OrderWeek)))) {
        const rows=period.rows.filter(r=>String(r.OrderWeek)===week), e=evidence[week]?.[p.ProdKey];
        const qty=rows.reduce((s,r)=>s+(physicalReceipt(r,p)||0),0), factor=e?marginUnitFactor(p,e.unit,p.EstUnit):null;
        const historicalFx=hasHistoricalMarginFx(e);
        const valid=e && NUM(e.price)!=null && e.price>=0 && factor>0 && !e.goodsCostMissing && historicalFx
          && Number(e.rowCount)===rows.length && completeReceiptCoverage(e,rows.map(r=>r.WdetailKey),rows.reduce((s,r)=>s+Number(r.OutQuantity),0))
          && qty>0 && rows.every(r=>physicalReceipt(r,p)>0 && Number(r.OutQuantity)>0 && NUM(r.TPrice)!=null && Number(r.TPrice)>=0);
        if(!valid) {complete=false;
          period.receiptReasons.push(!e?'해당 입고의 역사 도착원가 없음':!historicalFx?'입고 당시 환율 근거 부족':'입고 원가의 원문 행·수량 전체 대사 불일치');continue;}
        amount+=qty*e.price/factor;estimated ||= e.estimated===true;
        period.sourceRefs.push(...(e.sourceRefs||[]));
      }
      period.receiptComplete=complete;period.receiptAmount=complete?amount:null;period.estimated=estimated;
    }
    costs[p.ProdKey]=reconstructProductCost({product:p,periods,targetMajor:scope.major,orderYear:scope.year});
  }
  return {costs,warnings,adjustments:adjustments.filter(r=>Number(String(r.OrderWeek).split('-')[0])===Number(scope.major)).map(r=>({
    category:r.Category,year:scope.year,week:r.OrderWeek,unit:r.OutUnit,quantity:Number(r.Quantity),reason:r.Descr||'사유 미기재',recordedAt:r.ChangeDtm,
  }))};
}

async function storedReported(scope) {
  const confirmed=await getActiveConfirm(scope.year,scope.major);
  if(confirmed?.confirm) return {source:'confirmed',asOf:confirmed.confirm.confirmedAt,
    provenance:{table:'WebProfitReportConfirm',revisionNo:confirmed.confirm.revisionNo??null,confirmKey:confirmed.confirm.confirmKey??null},
    rows:Object.entries(confirmed.rowsByCategory).map(([category,value])=>({category,calc:value.calc,
      variant:profitReportCategoriesForWeek(Number(scope.major)).find(r=>r.key===category)?.variant||'normal'})),totals:confirmed.totalsCalc};
  try { const data=await readStoredProfitPayload(scope.year,scope.major);return {source:'stored',asOf:data.snapshot?.savedAt||null,rows:data.rows,totals:data.totals,
    provenance:{table:'WebProfitReportSnapshot',versionNo:data.snapshot?.versionNo??null,calcVersion:data.snapshot?.calcVersion??null}}; }
  catch(error) { if(error.statusCode===409||error.code==='PROFIT_CACHE_SCHEMA_MISSING') return {source:'unavailable',asOf:null,rows:[],totals:null,warning:error.message};throw error; }
}

export async function loadProfitCustomerMarginReconciliation(current,previous) {
  const asOf=new Date().toISOString(),classification=marginClassification();
  const [cr,pr,cs,ps]=await Promise.all([salesRows(current,classification),salesRows(previous,classification),storedReported(current),storedReported(previous)]);
  const reconciliation=buildMarginReconciliation({asOf,classification:classification.evidence,periods:[
    {side:'current',scope:current,rows:cr,stored:cs},{side:'previous',scope:previous,rows:pr,stored:ps},
  ]});
  return {ok:true,view:'reconciliation',current,previous,warnings:[cs.warning,ps.warning].filter(Boolean),
    metadata:{readOnly:true,modelVersion:MODEL_VERSION,asOf,completedAt:new Date().toISOString(),reconciliation:reconciliation.entries,reconciliationDetails:reconciliation}};
}

export async function loadProfitCustomerMargin(current,previous) {
  const asOf=new Date().toISOString(),classification=marginClassification();
  const adjustmentSql=`SELECT sh.OrderYear AS year,sh.OrderWeek AS week,p.OutUnit AS unit,sh.AfterValue-sh.BeforeValue AS quantity,
    sh.Descr AS reason,sh.ChangeDtm AS recordedAt,${classification.sql} AS category
    FROM StockHistory sh LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
    WHERE ((sh.OrderYear=@currentYear AND sh.OrderWeek LIKE @currentPrefix) OR (sh.OrderYear=@previousYear AND sh.OrderWeek LIKE @previousPrefix))
      AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`;
  const [cr,pr,cs,ps,allAdjustments]=await Promise.all([salesRows(current,classification),salesRows(previous,classification),storedReported(current),storedReported(previous),read(adjustmentSql,{
    currentYear:{type:sql.NVarChar,value:current.year},currentPrefix:{type:sql.NVarChar,value:current.major+'-%'},previousYear:{type:sql.NVarChar,value:previous.year},previousPrefix:{type:sql.NVarChar,value:previous.major+'-%'},
  })]);
  const keys=rows=>[...new Set(rows.filter(r=>r.kind==='N' && Number(r.prodKey)>0).map(r=>r.prodKey))];
  const [cc,pc]=await Promise.all([productCostBasis(current,keys(cr),classification),productCostBasis(previous,keys(pr),classification)]);
  const groups=buildCustomerMarginGroups({currentRows:cr,previousRows:pr,currentCosts:cc.costs,previousCosts:pc.costs,decompose:decomposeCustomerMargin});
  const costCoverage=(rows,costs)=>{
    const sales=new Map();for(const r of rows) if(r.kind==='N'&&r.quantity>0&&r.amount>=0) sales.set(r.prodKey,(sales.get(r.prodKey)||0)+r.amount);
    const reasons=new Map();let knownSales=0,knownProducts=0;
    for(const [pk,amount] of sales) {
      const basis=costs[pk];if(basis?.unitCost!=null) {knownSales+=amount;knownProducts++;continue;}
      for(const reason of basis?.reasons?.length?basis.reasons:['품목 원가 근거 없음']) {
        const item=reasons.get(reason)||{reason,productCount:0,sales:0};item.productCount++;item.sales+=amount;reasons.set(reason,item);
      }
    }
    const totalSales=[...sales.values()].reduce((s,v)=>s+v,0);
    return {knownProducts,unknownProducts:sales.size-knownProducts,knownSales,totalSales,salesCoverage:totalSales>0?knownSales/totalSales:null,
      reasons:[...reasons.values()],reasonCountsOverlap:true};
  };
  const categoryKeys=[...new Set([...cs.rows,...ps.rows].map(r=>r.category))];
  const pick=(data,category)=>{const row=data.rows.find(r=>r.category===category);return row?{...row.calc,variant:row.variant,source:data.source,asOf:data.asOf}:null;};
  const reconciliationDetails=buildMarginReconciliation({asOf,classification:classification.evidence,periods:[
    {side:'current',scope:current,rows:cr,stored:cs},{side:'previous',scope:previous,rows:pr,stored:ps},
  ]});
  const reconciliation=reconciliationDetails.entries;
  const reported=categoryKeys.map(category=>{
    const c=pick(cs,category),p=pick(ps,category),bridge=buildReportedProfitBridge({current:c,previous:p});
    return {category,current:c,previous:p,drivers:bridge.contributions,bridge,bridgeWarnings:bridge.warnings,
      adjustments:allAdjustments.filter(r=>r.category===category).map(r=>({...r,reason:r.reason||'사유 미기재'}))};
  });
  if(cs.totals&&ps.totals) {const bridge=buildReportedProfitBridge({current:cs.totals,previous:ps.totals,isTotal:true});reported.push({category:'__TOTAL__',isTotal:true,current:{...cs.totals,source:cs.source,asOf:cs.asOf},previous:{...ps.totals,source:ps.source,asOf:ps.asOf},drivers:bridge.contributions,bridge,bridgeWarnings:bridge.warnings,adjustments:[]});}
  const result={ok:true,current:{...current,asOf},previous:{...previous,asOf},groups,reported,
    warnings:[...new Set([cs.warning,ps.warning,...cc.warnings,...pc.warnings,
      '기존 보고서는 저장·확정 당시 값이며 업체 분석은 현재 SQL 읽기값입니다. 원장을 변경하거나 계산본을 갱신하지 않았습니다.',
      '별도 판매마진은 품목별 검증된 가중평균 원가 기준입니다. 재고조정 손익은 업체에 배부하지 않습니다.',
      '수량은 전산의 세부차수 ROUND2와 원천 입고·출고·조정 합계를 함께 검산합니다. 수량 검산이 일치하지 않는 항목만 수량 확인 필요로 보류하며, 원가 근거의 완전성은 별도로 확인합니다.',
      ...(reconciliationDetails.summaries.some(r=>r.status!=='match')?['현재 SQL 매출과 기존 저장 보고서 N/L/O 대사에 차이 또는 미확인 항목이 있습니다. 아래 저장본·SQL 대사 근거에서 차수·분류·금액을 확인하세요.']:[]),
    ].filter(Boolean))],metadata:{readOnly:true,modelVersion:MODEL_VERSION,asOf,completedAt:new Date().toISOString(),atomicSnapshot:false,
      historicalCostMemoTtlSeconds:30,reconciliation,reconciliationDetails,scopeCoverage:{current:cr.scopeCoverage,previous:pr.scopeCoverage}}};
  result.metadata.costCoverage={current:costCoverage(cr,cc.costs),previous:costCoverage(pr,pc.costs)};
  return result;
}
