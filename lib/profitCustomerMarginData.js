import { query, sql } from './db.js';
import { buildProfitReportCategorySql, CATEGORIES, profitReportCategoriesForWeek } from './profitReportCountryResolver.js';
import { buildProfitOverrideCaseSql } from './profitReportCategoryOverrides.js';
import { freightSalesProductSql } from './profitWorkbookRules.js';
import { readStoredProfitPayload } from './profitReportSnapshot.js';
import { getActiveConfirm } from './profitReportConfirm.js';
import { reportPeriodFreightArrivalEvidence } from './profitReport.js';
import { MODEL_VERSION, normalizeMarginUnit, marginUnitFactor, completeReceiptCoverage, reconstructProductCost, buildCustomerMarginGroups } from './profitCustomerMargin.mjs';
import { decomposeCustomerMargin, buildReportedProfitBridge } from './profitCustomerMarginDrivers.mjs';

const CATEGORY = buildProfitOverrideCaseSql(buildProfitReportCategorySql('p'), 'p', [...CATEGORIES.filter(c => !c.manualOnly).map(c => c.key), '국내']);
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

async function salesRows(scope) {
  const params = scopeParams(scope);
  const [sales, estimates, excluded] = await Promise.all([
    read(`SELECT sm.CustKey,c.CustName,sd.ProdKey,p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.EstUnit,
        p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch,${CATEGORY} AS Category,
        sd.OutQuantity,sd.EstQuantity,sd.Amount,sd.Vat,
        CASE WHEN ${freightSalesProductSql('p')} THEN N'O' ELSE N'N' END AS Kind
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      LEFT JOIN Product p ON p.ProdKey=sd.ProdKey LEFT JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE ${scopeSql} AND ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)<>0 AND NOT (${WEIGHT})`, params),
    read(`SELECT sm.CustKey,c.CustName,e.ProdKey,p.ProdName,p.CounName,p.FlowerName,p.EstUnit,${CATEGORY} AS Category,
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
      category: r.Category || '미분류', unit: normalizeMarginUnit(r.EstUnit), kind: r.Kind,
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
  if (arrivalMemo.size >= 24) arrivalMemo.delete(arrivalMemo.keys().next().value);
  const promise = reportPeriodFreightArrivalEvidence(year,week).catch(error => { arrivalMemo.delete(key); throw error; });
  arrivalMemo.set(key,{at:now,promise}); return promise;
}

function physicalReceipt(row, product) {
  const unit=normalizeMarginUnit(product.EstUnit);
  const field={박스:'BoxQuantity',단:'BunchQuantity',송이:'SteamQuantity'}[unit];
  return field ? NUM(row[field]) : null;
}

/** All product history is batched; a missing snapshot or missing priced line cannot become zero. */
export async function productCostBasis(scope, keys) {
  if (!keys.length) return { costs:{},adjustments:[],warnings:[] };
  const params={...scopeParams(scope),keys:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(keys)}};
  const [products,headers,stocks,receipts,ships,adjustments] = await Promise.all([
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
    read(`SELECT sh.OrderWeek,sh.ProdKey,sh.AfterValue-sh.BeforeValue AS Quantity,sh.Descr,sh.ChangeDtm,p.OutUnit,${CATEGORY} AS Category
      FROM StockHistory sh LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
      WHERE ${HIST('sh')} AND sh.ProdKey IN (${PK})
        AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`,params),
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
        endQuantity:h && factor!=null && stockAt(h,p.ProdKey)!=null ? stockAt(h,p.ProdKey)*factor:null,
        receiptQuantity:rr.reduce((s,r)=>s+(physicalReceipt(r,p)||0),0),receiptAmount:rr.length?null:0,receiptComplete:!rr.length,
        shipQuantity:factor==null?null:ss.reduce((s,r)=>s+Number(r.Quantity)*factor,0),
        adjustmentQuantity:factor==null?null:aa.reduce((s,r)=>s+Number(r.Quantity)*factor,0),hasPositiveAdjustment:aa.some(r=>Number(r.Quantity)>0),sourceRefs:[]});
      if(major>anchor) for(const r of rr) if((physicalReceipt(r,p)||0)>0) needed.add(String(r.OrderWeek));
    }
    plans[p.ProdKey]={p,periods};
  }
  // Bounded read work, never a recent-price fallback: older uncovered receipts remain MISSING.
  const weeks=[...needed].sort((a,b)=>Number(b.replace('-',''))-Number(a.replace('-',''))), selected=weeks.slice(0,12), evidence={};
  const warnings=weeks.length>selected.length ? ['원가 이월 복원에 필요한 과거 입고 차수가 조회 한도를 넘은 품목은 원가 확인 필요로 표시합니다.'] : [];
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
        const historicalFx=(e?.reportRateEvidence?.length>0 && e.reportRateEvidence.every(r=>Number(r.rate)>0 && !/currency_master|approximate|missing/i.test(r.source||'')))
          || e?.sourceRefs?.some(ref=>/:report-purchase-fx-[1-9]/.test(ref));
        const valid=e && NUM(e.price)!=null && e.price>=0 && factor>0 && !e.goodsCostMissing && historicalFx
          && Number(e.rowCount)===rows.length && completeReceiptCoverage(e,rows.map(r=>r.WdetailKey),rows.reduce((s,r)=>s+Number(r.OutQuantity),0))
          && qty>0 && rows.every(r=>physicalReceipt(r,p)>0 && Number(r.OutQuantity)>0 && NUM(r.TPrice)!=null && Number(r.TPrice)>=0);
        if(!valid) {complete=false;
          period.receiptReasons.push(!selected.includes(week)?'과거 원가 추가 조회 필요(읽기 한도)':!e?'해당 입고의 역사 도착원가 없음':!historicalFx?'입고 당시 환율 근거 부족':'입고 원가의 원문 행·수량 전체 대사 불일치');continue;}
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
    rows:Object.entries(confirmed.rowsByCategory).map(([category,value])=>({category,calc:value.calc,
      variant:profitReportCategoriesForWeek(Number(scope.major)).find(r=>r.key===category)?.variant||'normal'})),totals:confirmed.totalsCalc};
  try { const data=await readStoredProfitPayload(scope.year,scope.major);return {source:'stored',asOf:data.snapshot?.savedAt||null,rows:data.rows,totals:data.totals}; }
  catch(error) { if(error.statusCode===409||error.code==='PROFIT_CACHE_SCHEMA_MISSING') return {source:'unavailable',asOf:null,rows:[],totals:null,warning:error.message};throw error; }
}

export async function loadProfitCustomerMargin(current,previous) {
  const asOf=new Date().toISOString();
  const adjustmentSql=`SELECT sh.OrderYear AS year,sh.OrderWeek AS week,p.OutUnit AS unit,sh.AfterValue-sh.BeforeValue AS quantity,
    sh.Descr AS reason,sh.ChangeDtm AS recordedAt,${CATEGORY} AS category
    FROM StockHistory sh LEFT JOIN Product p ON p.ProdKey=sh.ProdKey
    WHERE ((sh.OrderYear=@currentYear AND sh.OrderWeek LIKE @currentPrefix) OR (sh.OrderYear=@previousYear AND sh.OrderWeek LIKE @previousPrefix))
      AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=sh.ChangeType)`;
  const [cr,pr,cs,ps,allAdjustments]=await Promise.all([salesRows(current),salesRows(previous),storedReported(current),storedReported(previous),read(adjustmentSql,{
    currentYear:{type:sql.NVarChar,value:current.year},currentPrefix:{type:sql.NVarChar,value:current.major+'-%'},previousYear:{type:sql.NVarChar,value:previous.year},previousPrefix:{type:sql.NVarChar,value:previous.major+'-%'},
  })]);
  const keys=rows=>[...new Set(rows.filter(r=>r.kind==='N' && Number(r.prodKey)>0).map(r=>r.prodKey))];
  const [cc,pc]=await Promise.all([productCostBasis(current,keys(cr)),productCostBasis(previous,keys(pr))]);
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
  const reconciliation=[];
  const reported=categoryKeys.map(category=>{
    const c=pick(cs,category),p=pick(ps,category),bridge=buildReportedProfitBridge({current:c,previous:p});
    for(const [side,rows,report] of [['current',cr,c],['previous',pr,p]]) if(report) for(const col of ['N','L','O']) {
      const sqlValue=rows.filter(r=>r.category===category && r.kind===col).reduce((s,r)=>s+r.amount,0);
      reconciliation.push({side,category,column:col,sqlValue,reported:report[col]??null,delta:report[col]==null?null:sqlValue-report[col]});
    }
    return {category,current:c,previous:p,drivers:bridge.contributions,bridge,bridgeWarnings:bridge.warnings,
      adjustments:allAdjustments.filter(r=>r.category===category).map(r=>({...r,reason:r.reason||'사유 미기재'}))};
  });
  if(cs.totals&&ps.totals) {const bridge=buildReportedProfitBridge({current:cs.totals,previous:ps.totals,isTotal:true});reported.push({category:'__TOTAL__',isTotal:true,current:{...cs.totals,source:cs.source,asOf:cs.asOf},previous:{...ps.totals,source:ps.source,asOf:ps.asOf},drivers:bridge.contributions,bridge,bridgeWarnings:bridge.warnings,adjustments:[]});}
  const result={ok:true,current:{...current,asOf},previous:{...previous,asOf},groups,reported,
    warnings:[...new Set([cs.warning,ps.warning,...cc.warnings,...pc.warnings,
      '기존 보고서는 저장·확정 당시 값이며 업체 분석은 현재 SQL 읽기값입니다. 원장을 변경하거나 계산본을 갱신하지 않았습니다.',
      '별도 판매마진은 품목별 검증된 가중평균 원가 기준입니다. 재고조정 손익은 업체에 배부하지 않습니다.',
      '전산은 세부차수별 입고·출고·조정 및 잔량을 ROUND2로 처리합니다. 원시 수량 대사 차이는 원장 오류로 단정하지 않고 추가 검산 필요로 보류합니다.',
      ...(reconciliation.some(r=>r.delta!=null&&Math.abs(r.delta)>0.01)?['현재 SQL 매출과 기존 저장 보고서 N/L/O 차이가 있습니다. 원천 조회시점·확정 범위를 확인하세요.']:[]),
    ].filter(Boolean))],metadata:{readOnly:true,modelVersion:MODEL_VERSION,asOf,completedAt:new Date().toISOString(),atomicSnapshot:false,
      historicalCostMemoTtlSeconds:30,reconciliation,scopeCoverage:{current:cr.scopeCoverage,previous:pr.scopeCoverage}}};
  result.metadata.costCoverage={current:costCoverage(cr,cc.costs),previous:costCoverage(pr,pc.costs)};
  return result;
}
