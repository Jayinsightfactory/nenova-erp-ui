import {computeProfitTotals,calcRevenueRatio,calcPurchaseRatio} from './profitReportCalc.js';
import {AVERAGE_FALLBACK_VERSION,costPeriod,weightedArrivalCost,resolveAverageStemFactor,averageInventoryValue} from './profitAverageFallback.mjs';
import {inventoryFallbackItems,receiptFallbackItems} from './profitAverageSources.mjs';
const n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
export function applyAverageFallbackView(payload,{year,major,rawRows=[],previousRows=[],donors=[],conversions=[],products=[],stocks=[],receipts=[],purchases=[],fxByCategory={},allowReferencePeriod=false,allowCurrentSnapshotBasis=false}={}){
 if(payload.averageFallback?.version===AVERAGE_FALLBACK_VERSION)return payload;
 const result=structuredClone(payload),changes=[];
 for(const row of result.rows||[]){
  const missingCustoms=['missing','partial'].includes(row.source?.H)&&n(row.manual?.H)==null&&row.calc?.H===0&&(n(row.calc?.Q)>0||n(row.calc?.S)>0);
  if((row.calc?.K!=null&&!missingCustoms)||row.calc?.C===0)continue;
  const raw=rawRows.find(r=>r.category===row.category)||row,c={...row.calc},evidence={},missing=[];
  const fx=fxByCategory[row.category];
  if(c.G==null&&n(c.R)==null&&n(raw.manual?.R)==null&&fx?.available===true&&n(fx.rate)>0){
   c.R=Number(fx.rate);c.P=n(c.Q)==null?null:Number(c.Q)*c.R;c.T=n(c.S)==null?null:Number(c.S)*c.R;
   if(c.P!=null&&c.T!=null)c.G=c.P+c.T;
   evidence.R={...fx,method:'official_rate_approved_timing',actualDeclarationDateVerified:false};
   evidence.G={method:'existing_foreign_goods_and_freight_times_official_rate',Q:c.Q,S:c.S,R:c.R};
   row.auto={...row.auto,R:c.R};row.source={...row.source,R:'approved_customs_timing_estimate'};
  }
  const items=receiptFallbackItems(row,year,major,products,receipts);
  if(missingCustoms&&items.some(item=>n(item.stems)>0||n(item.quantity)>0))c.H=null;
  const costItems=items.map(item=>{
   const conversion=item.stems==null?resolveAverageStemFactor(conversions,{...item,allowReferencePeriod}):null;
   const stems=n(item.stems)??(conversion?.available&&n(item.quantity)!=null?Number(item.quantity)*conversion.factor:null);
   return {...item,stems,conversion,cost:weightedArrivalCost(donors,{...item,period:costPeriod(year,`${String(major).padStart(2,'0')}-99`),allowReferencePeriod})};
  });
  const complete=costItems.length>0&&costItems.every(i=>i.stems>0&&i.cost.available);
  if((c.G==null||c.H==null)&&!complete)missing.push(...costItems.filter(i=>!(i.stems>0)||!i.cost.available).map(i=>`입고품목 ${i.prodKey}: ${i.conversion?.reason||i.cost.reason||'입고수량 확인 필요'}`));
  if(c.G==null&&complete){c.G=costItems.reduce((s,i)=>s+i.stems*i.cost.goodsFreightPerStem,0);evidence.G={method:'weighted_goods_freight',items:costItems};}
  if(c.H==null){
   const explicit=n(raw.manual?.H),original=n(row.templateDuty?.originalCalc?.H??raw.calc?.H??raw.auto?.H);
   if(explicit!=null){c.H=explicit;evidence.H={method:'manual_preserved'};}
   else if(['actual','excel_historical_snapshot'].includes(raw.source?.H)&&original!=null){c.H=original;evidence.H={method:'existing_total_preserved'};}
   else if(complete){
    const oldDuty=n(row.templateDuty?.oldDuty),knownDuty=n(row.templateDuty?.knownTotal),knownPartial=n(raw.actualCostEvidence?.knownTotal);
    const missingLines=new Set((row.templateDuty?.missing||[]).map(m=>Number(m.diagnostic?.sourceRef?.warehouseDetailKey)).filter(Number.isFinite));
    const canSplit=costItems.every(i=>i.cost.dutyPerStem!=null&&i.cost.otherCustomsPerStem!=null);
    if(canSplit&&knownDuty!=null&&!(knownPartial>0&&oldDuty==null)){
     const duty=knownDuty+costItems.filter(i=>missingLines.has(i.warehouseDetailKey)).reduce((s,i)=>s+i.stems*i.cost.dutyPerStem,0);
     const originalOtherComplete=['actual','manual','gw_auto','excel_historical_snapshot','approved_estimate'].includes(raw.source?.H);
     const other=oldDuty!=null&&original!=null&&originalOtherComplete?original-oldDuty:costItems.reduce((s,i)=>s+i.stems*i.cost.otherCustomsPerStem,0);
     c.H=duty+other;evidence.H={method:'known_duty_plus_missing_components',knownDuty,other,items:costItems};
    }else if(knownDuty==null&&!(knownPartial>0)){
     c.H=costItems.reduce((s,i)=>s+i.stems*i.cost.customsPerStem,0);evidence.H={method:'weighted_customs',items:costItems};
    }else missing.push('PARTIAL_CUSTOMS_COMPONENTS_REQUIRE_SEPARATION');
   }
  }
  for(const [side,col]of [['begin','E'],['end','F']])if(c[col]==null){
   const previous=previousRows.find(r=>r.category===row.category),previousEnd=previous?.inventoryValuation?.end,
    end=previousEnd?.originalBasis||previousEnd,begin=row.inventoryValuation?.begin?.originalBasis||row.inventoryValuation?.begin;
   if(side==='begin'&&n(previous?.calc?.F)!=null&&begin&&end
     &&(payload.stockWeeks?.beginStockKey==null||previousEnd?.stockKey==null||Number(payload.stockWeeks.beginStockKey)===Number(previousEnd.stockKey))
     &&String(begin.year)===String(end.year)&&begin.week===end.week&&begin.unit===end.unit&&n(begin.quantity)!=null&&begin.quantity===end.quantity){
    c.E=previous.calc.F;evidence.E={method:'same_snapshot_previous_ending',year:begin.year,week:begin.week,quantity:begin.quantity,unit:begin.unit,basis:previousEnd};continue;
   }
   const stockItems=inventoryFallbackItems(row,side,products,stocks,conversions,allowReferencePeriod,payload.stockWeeks?.[`${side}StockKey`],allowCurrentSnapshotBasis).map(i=>({...i,allowReferencePeriod}));
   const value=averageInventoryValue(stockItems,donors,conversions,purchases);
   if(value.available&&value.value!=null){c[col]=value.value;evidence[col]=value;}
   else {missing.push(...(value.missing||[]).map(m=>`${col}:${m.reason}`));if(!stockItems.length)missing.push(`${col}:STOCK_SCOPE_OR_BASIS_UNAVAILABLE`);}
  }
  if(Object.keys(evidence).length){
   const noEnd=row.variant==='noEnding';
   c.I=[c.E,c.G,c.H,...(noEnd?[]:[c.F])].some(v=>v==null)?null:c.E+c.G+c.H-(noEnd?0:c.F);
   c.J=c.I==null||c.F==null?null:c.C-c.I+(noEnd?c.F:0)+(c.AJ??0);
   const denominator=c.C+(noEnd?(c.F??0):0);c.K=c.J==null||!denominator?null:c.J/denominator;
   for(const [side,col]of [['begin','E'],['end','F']])if(evidence[col]){
    const old=row.inventoryValuation?.[side],details=evidence[col].details;
    const basis=evidence[col].basis?{...evidence[col].basis,value:c[col]}:{...old,originalBasis:old,value:c[col],method:'approved_average_cost',label:'품목 원가·평균 비용 보완',estimated:true,
     quantity:details?.reduce((s,d)=>s+(d.stems??0),0)??old?.quantity,unit:details?'송이':old?.unit,average:null,reason:null,dutyReviewRequired:false,dutyDiagnostic:null,normalization:null,averageFallbackEvidence:evidence[col],actualPaymentCertified:false};
    basis.stockKey=payload.stockWeeks?.[`${side}StockKey`]??basis.stockKey??evidence[col]?.details?.[0]?.stockKey??null;
    row.inventoryValuation={...row.inventoryValuation,[side]:basis};row.auto={...row.auto,[col]:c[col]};row.source={...row.source,[col]:'approved_estimate'};
    if(side==='end')row.stock={...row.stock,evidenceValue:c[col],priceEvidenceStatus:'APPROVED_ESTIMATE'};else row.beginStock={...row.beginStock,evidenceValue:c[col]};
   }
   if(evidence.H){row.auto={...row.auto,H:c.H};row.source={...row.source,H:evidence.H.method==='manual_preserved'?'manual':'approved_estimate'};}
   row.calc=c;row.calculationFrozen=true;row.averageFallback={version:AVERAGE_FALLBACK_VERSION,evidence,missing,actualPaymentCertified:false,originalCalc:payload.rows.find(r=>r.category===row.category)?.calc};
   changes.push(row.category);
  }else if(missing.length)row.averageFallback={version:AVERAGE_FALLBACK_VERSION,evidence:{},missing,actualPaymentCertified:false,originalCalc:{...row.calc}};
 }
 const totals=computeProfitTotals(result.rows);for(const row of result.rows)row.calc={...row.calc,D:calcRevenueRatio(row.calc,totals),U:calcPurchaseRatio(row.calc,totals)};
 result.totals=totals;result.effectiveViewTotals=totals;
 if(result.confirmed){result.originalConfirmedTotals??=payload.confirmedTotals;result.confirmedTotals=totals;}
 result.averageFallback={version:AVERAGE_FALLBACK_VERSION,changedCategories:changes,dbWrites:0,actualPaymentCertified:false};
 return result;
}
