import { query, sql, getPool } from './db.js';
import { currentErpReadContext, withErpReadContext } from './erpReadContext.js';
import { CASE_CATEGORY, refreshProfitCategorySql, stockablePurchaseItemSql, nonValueWeightSql, stockSnapshotByCategory } from './profitReport.js';
import { freightSalesProductSql } from './profitWorkbookRules.js';
import { buildForwardingLedger } from './customsForwarding.js';
import { countryToCurrency } from './countryClassification.js';

// Both SQL boundaries use explicit year and major. No stored report is loaded or refreshed.
export function chinaTransportSql() {
  return {
    incoming: `SELECT wm.OrderYear,wm.OrderWeek,wm.WarehouseKey,wm.OrderNo,wm.InvoiceNo,wm.FarmName,
      wd.WdetailKey AS WarehouseDetailKey,wd.ProdKey,wd.OutQuantity,wd.TPrice,
      wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,p.OutUnit,p.ProdName,p.CounName,p.FlowerName,
      ${CASE_CATEGORY} AS Category,
      CASE WHEN ${stockablePurchaseItemSql('p')} THEN 1 ELSE 0 END AS Stockable
      FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
      LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
      WHERE wm.OrderYear=@year AND wm.OrderWeek LIKE @prefix AND ISNULL(wm.isDeleted,0)=0`,
    shipments: `SELECT sm.OrderYear,sm.OrderWeek,sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.Amount,
      sf.SfarmKey,sf.ShipmentQuantity,f.FarmName
      FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
      LEFT JOIN ShipmentFarm sf ON sf.SdetailKey=sd.SdetailKey
      LEFT JOIN Farm f ON f.FarmKey=sf.FarmKey
      WHERE sm.OrderYear=@year AND sm.OrderWeek LIKE @prefix AND ISNULL(sm.OrderYearWeek,'')=@yearMajor
      AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1 AND ISNULL(sd.isFix,0)=1
      AND ISNULL(sd.OutQuantity,0)<>0 AND ${nonValueWeightSql('p')} AND NOT ${freightSalesProductSql('p')}
      AND (${CASE_CATEGORY})=N'중국'`,
  };
}

export async function loadChinaTransportEvidence(scope, dependencies = {}) {
  if(!dependencies.query && !currentErpReadContext()){
    const pool=await getPool();
    return withErpReadContext({allowExternalEvidenceReads:true,queryFn:async(statement,params={})=>{
      const request=pool.request();for(const[name,input]of Object.entries(params))request.input(name,input.type,input.value);
      return request.query(statement);
    }},()=>loadChinaTransportEvidence(scope,{...dependencies,query}));
  }
  const read = dependencies.query || query;
  const stock = dependencies.stockSnapshot || stockSnapshotByCategory;
  refreshProfitCategorySql();
  const statements=chinaTransportSql();
  const params={year:{type:sql.NVarChar,value:scope.orderYear},prefix:{type:sql.NVarChar,value:`${scope.major}-%`},
    yearMajor:{type:sql.NVarChar,value:`${scope.orderYear}${scope.major}`}};
  const incomingResult=await read(statements.incoming,params);
  const shipmentResult=await read(statements.shipments,params);
  const raw=incomingResult.recordset;
  const incoming=raw.filter(row=>row.Category==='중국'&&row.Stockable).map(row=>({
    orderYear:String(row.OrderYear),orderWeek:row.OrderWeek,warehouseKey:row.WarehouseKey,
    prodKey:row.ProdKey,productName:row.ProdName,farm:row.FarmName,unit:row.OutUnit,quantity:row.OutQuantity,amount:row.TPrice,
    currency:countryToCurrency(row.Category),currencyBasis:'report_category',
  }));
  const shipmentsByKey=new Map();
  for(const row of shipmentResult.recordset){
    let item=shipmentsByKey.get(row.SdetailKey);
    if(!item){item={orderYear:String(row.OrderYear),orderWeek:row.OrderWeek,prodKey:row.ProdKey,
      quantity:row.OutQuantity,amount:row.Amount,assignments:[]};shipmentsByKey.set(row.SdetailKey,item);}
    if(row.SfarmKey!=null)item.assignments.push({farm:row.FarmName,quantity:row.ShipmentQuantity});
  }
  const ledger=buildForwardingLedger(raw,{orderYear:scope.orderYear,major:scope.major});
  const freight=ledger.classifiedRows.filter(row=>row.category==='중국').map(row=>({
    orderYear:row.orderYear,orderWeek:row.orderWeek,warehouseKey:row.warehouseKey,farm:row.farmName,amount:row.amount,
  }));
  const warnings=[];
  for(const farm of [...new Set(incoming.map(row=>row.farm))]){
    const lines=freight.filter(row=>row.farm===farm);
    if(!lines.length)warnings.push(`${farm || '농장 미확인'}: 운임 전표 없음 — 운임 0으로 확정한 것이 아닙니다.`);
    else if(lines.some(row=>row.amount===0))warnings.push(`${farm || '농장 미확인'}: 운임 0원 전표 있음 — 별도 청구/누락 확인 필요.`);
  }
  // The report's previous stock scope is calendar-based; never assume last year has 52 weeks.
  let previous;
  if(Number(scope.major)>1)previous={orderYear:scope.orderYear,major:String(Number(scope.major)-1).padStart(2,'0')};
  else{
    const r=await read(`SELECT TOP(1) LEFT(CONVERT(nvarchar(20),OrderYearWeek),4) OrderYear,
      RIGHT(CONVERT(nvarchar(20),OrderYearWeek),2) Major FROM PeriodDay
      WHERE LEFT(CONVERT(nvarchar(20),OrderYearWeek),4)=@previousYear
      AND LEN(CONVERT(nvarchar(20),OrderYearWeek))=6
      AND TRY_CONVERT(int,RIGHT(CONVERT(nvarchar(20),OrderYearWeek),2)) BETWEEN 1 AND 53
      ORDER BY TRY_CONVERT(int,OrderYearWeek) DESC`,{previousYear:{type:sql.NVarChar,value:String(Number(scope.orderYear)-1)}});
    if(r.recordset[0])previous={orderYear:String(r.recordset[0].OrderYear),major:r.recordset[0].Major};
  }
  const inventory={begin:{items:[]},end:{items:[]}};
  for(const [phase,target] of [['begin',previous],['end',scope]]){
    if(!target){warnings.push('기초 재고 차수 확인 필요');continue;}
    const value=await stock(target.major,target.orderYear,{captureChinaItems:true});
    inventory[phase]={orderYear:target.orderYear,major:target.major,week:value.week,items:value.items||[]};
    if(!value.snapshotAvailable)warnings.push(`${phase==='begin'?'기초':'기말'} 재고 스냅샷 없음`);
    const missing=inventory[phase].items.filter(row=>row.value==null).length;
    if(missing)warnings.push(`${phase==='begin'?'기초':'기말'} 품목별 평가 근거 ${missing}건 미확인 — 저장본과 차이는 공통 비율 안분(원가 확정 아님)`);
  }
  return {...scope,incoming,shipments:[...shipmentsByKey.values()],freight,inventory,warnings,queriedAt:new Date().toISOString()};
}
